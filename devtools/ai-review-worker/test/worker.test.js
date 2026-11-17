import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { intake, processDelivery, validateJob } from "../src/worker.js";
import { shouldReopen } from "../src/db.js";
import { ConfigStore } from "../src/config.js";
import { JOBS, RESULTS, DLQ } from "../src/queue.js";

const quiet = { info() {}, error() {} };
const sha = (c) => c.repeat(40);

// In-memory stand-in for Db with the same semantics as the SQL version.
class FakeDb {
  constructor() {
    this.rows = [];
    this.clock = 0;
    this.locked = 0;
    this.maxLocked = 0;
  }
  async latestJob(projectId, mrIid) {
    return (
      this.rows
        .filter(
          (r) =>
            r.project_id === projectId &&
            r.mr_iid === mrIid &&
            r.status !== "skipped" &&
            r.status !== "superseded",
        )
        .at(-1)?.job ?? null
    );
  }
  async upsertQueued(job, status, reason = null) {
    const key = job.context_key ?? "";
    const ex = this.rows.find(
      (r) =>
        r.project_id === job.project_id &&
        r.mr_iid === job.mr_iid &&
        r.head_sha === job.head_sha &&
        r.context_key === key,
    );
    if (!ex) {
      const run = {
        id: `r${this.rows.length + 1}`,
        project_id: job.project_id,
        project_path: job.project_path,
        mr_iid: job.mr_iid,
        head_sha: job.head_sha,
        context_key: key,
        status,
        reason,
        attempts: 0,
        job: structuredClone(job),
        created_at: ++this.clock,
      };
      this.rows.push(run);
      return { run, created: true };
    }
    if (shouldReopen(ex, job)) {
      Object.assign(ex, {
        status,
        reason,
        job,
        attempts: 0,
        created_at: ++this.clock,
      });
      return { run: ex, created: false, reopened: true };
    }
    return { run: ex, created: false };
  }
  async byId(id) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async setStatus(id, status, f = {}) {
    const r = await this.byId(id);
    Object.assign(r, {
      status,
      reason: f.reason ?? r.reason,
      decision: f.decision ?? r.decision,
      result: f.result ?? r.result,
    });
    if (f.incAttempts) r.attempts++;
    return { ...r };
  }
  async newerRun(run) {
    return (
      this.rows
        .filter(
          (r) =>
            r.project_id === run.project_id &&
            r.mr_iid === run.mr_iid &&
            r.id !== run.id &&
            r.created_at > run.created_at &&
            ["queued", "running", "done"].includes(r.status),
        )
        .at(-1) ?? null
    );
  }
  async queuePosition(run) {
    return (
      this.rows.filter(
        (r) =>
          (r.status === "queued" && r.created_at < run.created_at) ||
          r.status === "running",
      ).length + 1
    );
  }
  async lockReview() {
    this.locked++;
    this.maxLocked = Math.max(this.maxLocked, this.locked);
    return async () => {
      this.locked--;
    };
  }
}

function harness(yaml = "{}") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wk-"));
  fs.writeFileSync(path.join(dir, "review.yaml"), yaml);
  const configStore = new ConfigStore(path.join(dir, "review.yaml"), quiet);
  const db = new FakeDb();
  const sent = [];
  const publish = async (q, m) => {
    sent.push({ q, m });
  };
  return { dir, configStore, db, sent, publish };
}

const job = (over = {}) => ({
  project_id: 1,
  project_path: "g/p",
  mr_iid: 5,
  source_branch: "feature/x",
  target_branch: "develop",
  base_sha: sha("a"),
  head_sha: sha("b"),
  title: "t",
  ...over,
});

test("validateJob checks required fields and SHAs", () => {
  assert.throws(() => validateJob({}), /missing/);
  assert.throws(() => validateJob(job({ head_sha: "abc" })), /40-character/);
  assert.deepEqual(validateJob(job({ labels: [{ title: "x" }] })).labels, [
    "x",
  ]);
});

test("intake queues once; a webhook retry is a duplicate", async () => {
  const h = harness();
  const a = await intake(job(), h);
  assert.equal(a.status, "queued");
  assert.match(a.queued_note, /^AI review for b{40}:/);
  const b = await intake(job(), h);
  assert.equal(b.status, "duplicate");
  assert.equal(h.sent.filter((s) => s.q === JOBS).length, 1);
});

test("a lost publish marks the run failed so a retry re-opens it", async () => {
  const h = harness();
  const broken = {
    ...h,
    publish: async () => {
      throw new Error("channel closed");
    },
  };
  await assert.rejects(intake(job(), broken), /enqueue failed/);
  assert.equal(h.db.rows[0].status, "failed");
  assert.equal((await intake(job(), h)).status, "queued");
});

test("intake skips out-of-scope targets, then re-opens when the header allows it", async () => {
  const h = harness("defaults:\n  scope:\n    target_branches: [develop]\n");
  const s = await intake(job({ target_branch: "prod" }), h);
  assert.equal(s.status, "skipped");
  assert.match(s.reason, /target prod not in config target_branches/);
  assert.equal(h.sent.length, 0);
  const q = await intake(
    job({ target_branch: "prod", review_only: "prod, release/*" }),
    h,
  );
  assert.equal(q.status, "queued");
});

test("queue: serial runs, stale pushes superseded, only newest reviewed", async () => {
  const h = harness();
  const reviewed = [];
  const deps = { artifacts: { put: async () => {} } };
  // Three quick pushes on MR 5, then one other MR.
  for (const c of ["1", "2", "3"]) await intake(job({ head_sha: sha(c) }), h);
  await intake(job({ mr_iid: 6, head_sha: sha("4") }), h);
  const env = {};
  // Fake reviewJob through deps: stub provider path by making base==head impossible -> use repoFactory.
  const repoFactory = () => ({
    fetchShas: async () => {},
    changedFiles: async () => ["src/a.js"],
    diffStat: async () => "stat",
    diff: async () => "diff",
    grep: async () => ({ hits: [], total: 0 }),
    listDir: async () => [],
    entry: async () => ({ mode: "100644", type: "blob" }),
    lineCount: async () => 10,
  });
  const providerFactory = () => ({
    chat: async () => ({
      json: {
        action: "review",
        review: {
          match: { items: [], explanation: "" },
          regression: { risk: "none", explanation: "", affected: [] },
          blockers: [],
          potentialBugs: [],
          recommendations: [],
        },
      },
    }),
  });
  const jobs = h.sent.filter((s) => s.q === JOBS).map((s) => s.m);
  const outcomes = await Promise.all(
    jobs.map((m) =>
      processDelivery(m, {
        redelivered: false,
        configStore: h.configStore,
        db: h.db,
        publish: h.publish,
        env,
        deps: { ...deps, repoFactory, providerFactory },
        log: quiet,
      }).then((o) => {
        reviewed.push(m.run_id);
        return o.outcome;
      }),
    ),
  );
  assert.deepEqual(outcomes, ["superseded", "superseded", "done", "done"]);
  assert.equal(h.db.maxLocked >= 1, true);
  const results = h.sent.filter((s) => s.q === RESULTS).map((s) => s.m);
  assert.deepEqual(results.map((r) => r.head_sha).sort(), [sha("3"), sha("4")]);
  assert.equal(results[0].approval, "approve");
  assert.match(results[0].note_body, /^AI review for /);
});

test("crash mid-run: redelivered running job resumes; non-redelivered is stale", async () => {
  const h = harness();
  await intake(job(), h);
  const run = h.db.rows[0];
  run.status = "running";
  const base = {
    configStore: h.configStore,
    db: h.db,
    publish: h.publish,
    env: {},
    log: quiet,
    deps: { artifacts: { put: async () => {} } },
  };
  assert.equal(
    (await processDelivery({ run_id: run.id }, { ...base, redelivered: false }))
      .outcome,
    "stale",
  );
  // base == head short-circuits without a model call.
  run.job = { ...run.job, base_sha: run.job.head_sha };
  assert.equal(
    (await processDelivery({ run_id: run.id }, { ...base, redelivered: true }))
      .outcome,
    "nothing_to_compare",
  );
  assert.equal(run.status, "done");
});

test("hourly circuit breaker throttles one MR whatever the head", async () => {
  const h = harness("defaults:\n  runtime:\n    max_runs_per_mr_per_hour: 3\n");
  h.db.runsLastHour = async (pid, iid) =>
    h.db.rows.filter(
      (r) => r.project_id === pid && r.mr_iid === iid && r.status !== "skipped",
    ).length;
  h.db.get = async (pid, iid, head, key) =>
    h.db.rows.find(
      (r) =>
        r.project_id === pid &&
        r.mr_iid === iid &&
        r.head_sha === head &&
        r.context_key === key,
    ) ?? null;
  const out = [];
  for (const c of ["1", "2", "3", "4", "5"])
    out.push((await intake(job({ head_sha: sha(c) }), h)).status);
  assert.deepEqual(out, [
    "queued",
    "queued",
    "queued",
    "throttled",
    "throttled",
  ]);
  // A duplicate of an existing run is still a duplicate, not throttled.
  assert.equal(
    (await intake(job({ head_sha: sha("1") }), h)).status,
    "duplicate",
  );
  // Other MRs are unaffected.
  assert.equal(
    (await intake(job({ mr_iid: 99, head_sha: sha("6") }), h)).status,
    "queued",
  );
});

test("crash loop: a redelivered running run past the retry budget fails closed without reviewing", async () => {
  const h = harness("defaults:\n  runtime:\n    retry_count: 1\n");
  await intake(job(), h);
  const run = h.db.rows[0];
  run.status = "running";
  run.attempts = 2;
  let reviewed = false;
  const deps = {
    artifacts: { put: async () => {} },
    repoFactory: () => {
      reviewed = true;
      throw new Error("should not run");
    },
  };
  const r = await processDelivery(
    { run_id: run.id },
    {
      redelivered: true,
      configStore: h.configStore,
      db: h.db,
      publish: h.publish,
      env: {},
      deps,
      log: quiet,
    },
  );
  assert.equal(r.outcome, "failed");
  assert.equal(reviewed, false);
  assert.equal(run.status, "failed");
  const res = h.sent.find((s) => s.q === RESULTS).m;
  assert.match(
    res.note_body,
    /did not finish, so this commit is \*\*not approved\*\*/,
  );
  assert.ok(h.sent.some((s) => s.q === DLQ));
});

test("errors retry once, then fail closed with a note, unapprove and DLQ", async () => {
  const h = harness("defaults:\n  runtime:\n    retry_count: 1\n");
  await intake(job(), h);
  const deps = {
    artifacts: { put: async () => {} },
    repoFactory: () => ({
      fetchShas: async () => {
        throw new Error("gitlab down");
      },
    }),
  };
  const base = {
    configStore: h.configStore,
    db: h.db,
    publish: h.publish,
    env: {},
    log: quiet,
    deps,
    redelivered: false,
  };
  const id = h.db.rows[0].id;
  assert.equal((await processDelivery({ run_id: id }, base)).outcome, "retry");
  assert.equal((await processDelivery({ run_id: id }, base)).outcome, "failed");
  const failed = h.sent.find((s) => s.q === RESULTS).m;
  assert.equal(failed.status, "failed");
  assert.equal(failed.approval, "unapprove");
  assert.match(failed.note_body, /not approved/);
  assert.ok(h.sent.some((s) => s.q === DLQ));
  // A failed SHA can be queued again by a new webhook.
  assert.equal((await intake(job(), h)).status, "queued");
});

const noWait = { sleep: async () => {}, diffAttempts: 3, diffWaitMs: 0 };

test("intake fills a missing base from GitLab once the diff is prepared", async () => {
  const h = harness();
  let calls = 0;
  const gitlab = {
    mr: async () => {
      calls++;
      if (calls < 2) return { state: "opened", sha: sha("b"), diff_refs: null };
      return {
        state: "opened",
        sha: sha("b"),
        diff_refs: {
          base_sha: sha("a"),
          start_sha: sha("c"),
          head_sha: sha("b"),
        },
      };
    },
  };
  const out = await intake(job({ base_sha: "" }), { ...h, gitlab, ...noWait });
  assert.equal(out.status, "queued");
  assert.equal(calls, 2);
  assert.equal(h.db.rows[0].job.base_sha, sha("a"));
  assert.equal(h.db.rows[0].job.start_sha, sha("c"));
});

test("intake does not queue or post a note while GitLab has no diff yet", async () => {
  const h = harness();
  const gitlab = {
    mr: async () => ({ state: "opened", sha: sha("b"), diff_refs: null }),
  };
  const out = await intake(job({ base_sha: "" }), { ...h, gitlab, ...noWait });
  assert.equal(out.status, "not_ready");
  assert.equal(h.db.rows.length, 0);
  assert.equal(h.sent.length, 0);
});

test("a done run that had no base is reviewed when a later event has one", async () => {
  const h = harness();
  await intake(job(), h);
  const run = h.db.rows[0];
  run.status = "done";
  run.job = { ...run.job, base_sha: "" };
  run.result = { status: "nothing_to_compare" };
  const again = await intake(job(), h);
  assert.equal(again.status, "queued");
  assert.equal(again.run_id, run.id);
  assert.equal(run.job.base_sha, sha("a"));
  assert.equal(h.sent.filter((s) => s.q === JOBS).length, 2);
});
