import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  resolveRelatedProjects,
  pairProjects,
  contextKey,
  relatedEntries,
} from "../src/pairing.js";
import { crossTerms, gatherCrossRepo } from "../src/crossrepo.js";
import { parseDiff } from "../src/diffparse.js";
import { runReads } from "../src/loop.js";
import { intake } from "../src/worker.js";
import { shouldReopen } from "../src/db.js";
import { ConfigStore, parseConfigText, resolveProject } from "../src/config.js";
import { Repo } from "../src/git.js";

const cfg = (yaml = "{}") => resolveProject(parseConfigText(yaml), "g/web");
const quiet = { info() {}, error() {} };
const sha = (c) => c.repeat(40);

// A fake GitLab: projects, groups, open MRs, branches.
function fakeGitlab({ projects, mrs = [], branches = {} }) {
  const byPath = new Map(projects.map((p) => [p.path_with_namespace, p]));
  const calls = [];
  return {
    calls,
    project: async (p) => byPath.get(p) ?? null,
    group: async (g) =>
      projects.some((p) => p.path_with_namespace.startsWith(`${g}/`))
        ? { full_path: g }
        : null,
    groupProjects: async (g) =>
      projects.filter((p) => p.path_with_namespace.startsWith(`${g}/`)),
    openMrsBySourceBranch: async (id, b) => {
      calls.push(["branch", id, b]);
      return mrs.filter((m) => m.project_id === id && m.source_branch === b);
    },
    openMrsMentioning: async (id, t) => {
      calls.push(["mention", id, t]);
      return mrs.filter(
        (m) => m.project_id === id && `${m.title} ${m.description}`.includes(t),
      );
    },
    mr: async (id, iid) =>
      mrs.find((m) => m.project_id === id && m.iid === iid) ?? null,
    branch: async (id, name) =>
      branches[`${id}:${name}`]
        ? { commit: { id: branches[`${id}:${name}`] } }
        : null,
    openMrsAnywhereBySourceBranch: async (b) =>
      mrs.filter(
        (m) => m.source_branch === b && (m.state ?? "opened") === "opened",
      ),
    projectById: async (id) =>
      projects.find((p) => p.id === Number(id)) ?? null,
  };
}

const P = (id, p) => ({
  id,
  path_with_namespace: p,
  default_branch: "main",
  web_url: `https://g/${p}`,
});
const PROJECTS = [
  P(1, "g/web"),
  P(2, "g/core"),
  P(3, "g/docs"),
  P(4, "g/sub/mobile"),
  P(5, "other/x"),
];

test("resolve: project, group, glob, exclude, never self, capped", async () => {
  const gl = fakeGitlab({ projects: PROJECTS });
  const names = async (entries, max = 10) =>
    (
      await resolveRelatedProjects({
        entries,
        gitlab: gl,
        selfPath: "g/web",
        max,
      })
    ).map((p) => p.path);
  assert.deepEqual(await names(["g/core"]), ["g/core"]);
  assert.deepEqual((await names(["g"])).sort(), [
    "g/core",
    "g/docs",
    "g/sub/mobile",
  ]);
  assert.deepEqual((await names(["g", "!g/docs"])).sort(), [
    "g/core",
    "g/sub/mobile",
  ]);
  assert.deepEqual((await names(["g/*"])).sort(), ["g/core", "g/docs"]);
  assert.deepEqual((await names(["g/**"])).sort(), [
    "g/core",
    "g/docs",
    "g/sub/mobile",
  ]);
  assert.deepEqual(await names(["nope/missing"]), []);
  assert.equal((await names(["g"], 1)).length, 1);
});

test("X-Review-Related-Max replaces max_projects, bounded by the ceiling", async () => {
  const { relatedMax } = await import("../src/pairing.js");
  const c = cfg(
    "defaults:\n  related:\n    max_projects: 5\n    max_projects_ceiling: 8\n",
  );
  assert.equal(relatedMax(c, {}), 5);
  assert.equal(relatedMax(c, { review_related_max: null }), 5);
  assert.equal(relatedMax(c, { review_related_max: 2 }), 2);
  assert.equal(relatedMax(c, { review_related_max: 0 }), 0);
  assert.equal(relatedMax(c, { review_related_max: 50 }), 8);
  assert.equal(
    relatedMax(
      cfg(
        "defaults:\n  related:\n    max_projects: 9\n    max_projects_ceiling: 3\n",
      ),
      {},
    ),
    3,
  );
  const { validateJob } = await import("../src/worker.js");
  const base = {
    project_id: 1,
    project_path: "g/p",
    mr_iid: 1,
    source_branch: "s",
    target_branch: "prod",
    head_sha: "a".repeat(40),
  };
  assert.equal(
    validateJob({ ...base, review_related_max: " 3 " }).review_related_max,
    3,
  );
  for (const bad of ["", "all", "-1", "2.5", "9999", undefined])
    assert.equal(
      validateJob({ ...base, review_related_max: bad }).review_related_max,
      null,
      String(bad),
    );
});

test("intake honors X-Review-Related-Max when pairing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-"));
  fs.writeFileSync(
    path.join(dir, "review.yaml"),
    "defaults:\n  related:\n    paths: [g]\n    max_projects: 1\n",
  );
  const configStore = new ConfigStore(path.join(dir, "review.yaml"), quiet);
  const gitlab = fakeGitlab({
    projects: PROJECTS,
    branches: { "2:prod": sha("2"), "3:prod": sha("3"), "4:prod": sha("4") },
  });
  const j = (extra) => ({
    project_id: 1,
    project_path: "g/web",
    mr_iid: 3,
    source_branch: "s",
    target_branch: "prod",
    base_sha: sha("a"),
    head_sha: sha("1"),
    ...extra,
  });
  const one = await intake(j({}), {
    configStore,
    db: new MemDb(),
    publish: async () => {},
    gitlab,
    log: quiet,
  });
  assert.equal(one.paired.length, 1);
  const three = await intake(j({ review_related_max: "3" }), {
    configStore,
    db: new MemDb(),
    publish: async () => {},
    gitlab,
    log: quiet,
  });
  assert.equal(three.paired.length, 3);
  const none = await intake(j({ review_related_max: "0" }), {
    configStore,
    db: new MemDb(),
    publish: async () => {},
    gitlab,
    log: quiet,
  });
  assert.equal(none.paired.length, 0);
});

test("related entries are normalized: slashes, full URLs, MR URLs, .git, excludes", async () => {
  const { normalizeRelatedEntry } = await import("../src/pairing.js");
  assert.equal(normalizeRelatedEntry("/internal/qestor"), "internal/qestor");
  assert.equal(normalizeRelatedEntry("internal/qestor/"), "internal/qestor");
  assert.equal(
    normalizeRelatedEntry(
      "https://gitlab.devops.yadatechnology.com/internal/qestor/qestor-web",
    ),
    "internal/qestor/qestor-web",
  );
  assert.equal(
    normalizeRelatedEntry(
      "https://gitlab.x/internal/qestor/qestor-core/-/merge_requests/36",
    ),
    "internal/qestor/qestor-core",
  );
  assert.equal(
    normalizeRelatedEntry("git@x:internal/a.git"),
    "git@x:internal/a",
  );
  assert.equal(
    normalizeRelatedEntry("!/internal/qestor/gitlab-profile/"),
    "!internal/qestor/gitlab-profile",
  );
  const c = cfg();
  assert.deepEqual(relatedEntries(c, { review_related: "/internal/qestor" }), [
    "internal/qestor",
  ]);
  const { validateJob } = await import("../src/worker.js");
  const j = validateJob({
    project_id: 1,
    project_path: "g/p",
    mr_iid: 1,
    source_branch: "s",
    target_branch: "prod",
    head_sha: "a".repeat(40),
    review_related: "https://gitlab.x/internal/qestor, /g/core",
  });
  assert.deepEqual(relatedEntries(c, j), ["internal/qestor", "g/core"]);
});

test("the leading-slash header from MR !69 resolves to the group", async () => {
  const gl = fakeGitlab({ projects: PROJECTS });
  const got = await resolveRelatedProjects({
    entries: relatedEntries(cfg(), { review_related: "/g" }),
    gitlab: gl,
    selfPath: "g/web",
    max: 10,
  });
  assert.deepEqual(got.map((p) => p.path).sort(), [
    "g/core",
    "g/docs",
    "g/sub/mobile",
  ]);
  const miss = await resolveRelatedProjects({
    entries: ["nope/x"],
    gitlab: gl,
    selfPath: "g/web",
    max: 10,
  });
  assert.deepEqual(miss.unmatched, ["nope/x"]);
});

test("a rate-limited item lookup keeps the MR's known items and blocks approval", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-"));
  fs.writeFileSync(path.join(dir, "review.yaml"), "{}");
  const configStore = new ConfigStore(path.join(dir, "review.yaml"), quiet);
  const db = new MemDb();
  const ctx = {
    configStore,
    db,
    publish: async () => {},
    gitlab: null,
    log: quiet,
  };
  const j = (extra) => ({
    project_id: 1,
    project_path: "g/web",
    mr_iid: 3,
    source_branch: "feature/x",
    target_branch: "prod",
    base_sha: sha("a"),
    head_sha: sha("1"),
    ...extra,
  });
  await intake(
    j({ qestor_items: [{ public_id: "QES-1", title: "one" }] }),
    ctx,
  );
  db.rows[0].status = "done";
  const r = await intake(
    j({ head_sha: sha("2"), qestor_items: [], qestor_items_incomplete: true }),
    ctx,
  );
  assert.equal(r.status, "queued");
  const row = db.rows.at(-1);
  assert.deepEqual(
    row.job.qestor_items.map((i) => i.public_id),
    ["QES-1"],
  );
  assert.equal(row.job.qestor_items_incomplete, true);
  const { decideApproval, normalizeReview } = await import("../src/verdict.js");
  const rv = normalizeReview(
    {
      match: { items: [], explanation: "" },
      regression: { risk: "none", explanation: "", affected: [] },
      blockers: [],
      potentialBugs: [],
      recommendations: [],
    },
    { items: [] },
  );
  assert.match(
    decideApproval(rv, cfg(), ["a"], { itemsIncomplete: true }).reasons.join(),
    /item lookup was incomplete/,
  );
});

test("header X-Review-Related replaces config paths", () => {
  const c = cfg("defaults:\n  related:\n    paths: [g/core]\n");
  assert.deepEqual(relatedEntries(c, { review_related: "" }), ["g/core"]);
  assert.deepEqual(relatedEntries(c, { review_related: "g/docs, g/sub/*" }), [
    "g/docs",
    "g/sub/*",
  ]);
});

test("pairing order: same branch, then Qestor item, then target branch fallback", async () => {
  const mrs = [
    {
      project_id: 2,
      iid: 7,
      source_branch: "feature/QES-1",
      target_branch: "prod",
      title: "core",
      description: "",
      web_url: "https://g/g/core/-/merge_requests/7",
      diff_refs: { base_sha: sha("b"), head_sha: sha("c") },
    },
    {
      project_id: 3,
      iid: 9,
      source_branch: "other",
      target_branch: "prod",
      title: "docs for QES-1",
      description: "",
      web_url: "u",
      diff_refs: { base_sha: sha("d"), head_sha: sha("e") },
    },
  ];
  const gl = fakeGitlab({
    projects: PROJECTS,
    mrs,
    branches: { "4:prod": sha("f") },
  });
  const job = {
    source_branch: "feature/QES-1",
    target_branch: "prod",
    qestor_items: [{ public_id: "QES-1" }],
  };
  const R = (p) => ({
    id: p.id,
    path: p.path_with_namespace,
    default_branch: p.default_branch,
    web_url: p.web_url,
  });
  const paired = await pairProjects({
    projects: [R(P(2, "g/core")), R(P(3, "g/docs")), R(P(4, "g/sub/mobile"))],
    job,
    cfg: cfg(),
    gitlab: gl,
  });
  assert.deepEqual(
    paired.map((p) => [p.path, p.mode, p.mr_iid ?? p.ref, p.how]),
    [
      ["g/core", "mr", 7, "same source branch"],
      ["g/docs", "mr", 9, "mentions `QES-1`"],
      ["g/sub/mobile", "branch", "prod", "same target branch"],
    ],
  );
  assert.equal(paired[0].head_sha, sha("c"));
  const none = await pairProjects({
    projects: [R(P(4, "g/sub/mobile"))],
    job,
    cfg: cfg("defaults:\n  related:\n    fallback: none\n"),
    gitlab: gl,
  });
  assert.equal(none.length, 0);
});

test("contextKey changes only when a paired head moves", () => {
  const a = [
    { path: "g/core", head_sha: sha("1") },
    { path: "g/docs", head_sha: sha("2") },
  ];
  assert.equal(contextKey([]), "");
  assert.equal(contextKey(a), contextKey([...a].reverse()));
  assert.notEqual(
    contextKey(a),
    contextKey([{ ...a[0], head_sha: sha("3") }, a[1]]),
  );
});

test("addedApiPaths stops at queries and template expressions", async () => {
  const { addedApiPaths } = await import("../src/crossrepo.js");
  const diff =
    'diff --git a/c.js b/c.js\n--- a/c.js\n+++ b/c.js\n@@ -1 +1,2 @@\n+fetch(`/api/e2e-pages/all?page=${p}`)\n+axios.get("/api/users/" + id)\n';
  assert.deepEqual(addedApiPaths(parseDiff(diff)).sort(), [
    "/api/e2e-pages/all",
    "/api/users",
  ]);
});

test("crossTerms picks API paths, GraphQL operations, symbols, snake_case", () => {
  const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,3 @@
+const r = await fetch('/api/items/\${id}/comments');
+const q = gql\`query ListItemGroups { item_group_page { id } }\`;
+export function loadItemGroups() {}
`;
  const t = crossTerms(parseDiff(diff), 12);
  assert.ok(
    t.includes("/api/items//comments") ||
      t.some((x) => x.startsWith("/api/items")),
  );
  assert.ok(t.includes("ListItemGroups"));
  assert.ok(t.includes("item_group_page"));
  assert.ok(t.includes("loadItemGroups"));
});

function gitRepo(root, name, files) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const g = (...a) =>
    execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();
  g("init", "-q", "-b", "prod");
  g("config", "user.email", "t@t.local");
  g("config", "user.name", "t");
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
  }
  g("add", ".");
  g("commit", "-qm", "base");
  return { dir, g, head: () => g("rev-parse", "HEAD") };
}

test("gatherCrossRepo: paired MR diff + uses in the other repo; reads can target it", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xr-"));
  const core = gitRepo(root, "core", {
    "api/items.js":
      "router.get('/api/items/list', handler);\nexport const item_group_page = 1;\n",
  });
  const base = core.head();
  fs.writeFileSync(
    path.join(core.dir, "api/items.js"),
    "router.get('/api/items/all', handler);\nexport const item_group_page = 1;\n",
  );
  core.g("commit", "-qam", "rename route");
  const head = core.head();
  core.g("update-ref", "refs/merge-requests/7/head", head);

  const webDiff = `diff --git a/src/api.js b/src/api.js
--- a/src/api.js
+++ b/src/api.js
@@ -1 +1 @@
-fetch('/api/items/old')
+fetch('/api/items/list')
`;
  const paired = [
    {
      path: "g/core",
      id: 2,
      mode: "mr",
      how: "same source branch",
      mr_iid: 7,
      title: "rename route",
      target_branch: "prod",
      base_sha: base,
      head_sha: head,
      web_url: "https://g/g/core",
    },
  ];
  const repoFor = async (p) => {
    const r = new Repo({
      reposDir: path.join(root, "repos"),
      projectId: p.id,
      projectPath: p.path,
      gitlabUrl: "x",
      token: "",
      extraConfig: [["protocol.file.allow", "always"]],
    });
    r.remote = core.dir;
    await r.fetchShas({
      mrIid: p.mr_iid,
      targetBranch: p.target_branch,
      baseSha: p.base_sha,
      headSha: p.head_sha,
    });
    return r;
  };
  const out = await gatherCrossRepo({
    paired,
    files: parseDiff(webDiff),
    cfg: cfg(),
    repoFor,
    log: quiet,
  });
  assert.match(out.text, /### `g\/core` — paired MR !7 \(same source branch\)/);
  // The web MR calls /api/items/list; the paired head renamed it to /all.
  assert.match(
    out.text,
    /- `\/api\/items\/list`: \*\*NOT FOUND\*\*\. This repository has `\/api\/items\/all` \(`api\/items\.js:1`\)/,
  );
  assert.match(out.text, /-router\.get\('\/api\/items\/list'/);
  assert.match(out.text, /\+router\.get\('\/api\/items\/all'/);
  assert.equal(out.repos.length, 1);

  const others = new Map(out.repos.map((p) => [p.path, p]));
  const reads = await runReads(
    [
      {
        kind: "file",
        repo: "g/core",
        path: "api/items.js",
        start_line: 1,
        end_line: 2,
      },
      { kind: "file", repo: "g/evil", path: "x" },
    ],
    {
      repo: null,
      headSha: "x",
      cfg: cfg(),
      qestorLookup: async () => [],
      others,
    },
  );
  assert.match(reads, /File api\/items\.js in `g\/core` lines 1-2/);
  assert.match(reads, /'\/api\/items\/all'/);
  assert.match(reads, /g\/evil is not one of the related repositories/);
});

// --- intake: pairing, key, re-review chain --------------------------------

class MemDb {
  constructor() {
    this.rows = [];
    this.clock = 0;
  }
  async get(pid, iid, head, key = "") {
    return (
      this.rows.find(
        (r) =>
          r.project_id === pid &&
          r.mr_iid === iid &&
          r.head_sha === head &&
          r.context_key === key,
      ) ?? null
    );
  }
  async countRuns(pid, iid, head) {
    return this.rows.filter(
      (r) =>
        r.project_id === pid &&
        r.mr_iid === iid &&
        r.head_sha === head &&
        r.status !== "skipped",
    ).length;
  }
  async latestOwnItems(pid, iid, head) {
    return (
      this.rows
        .filter(
          (r) =>
            r.project_id === pid &&
            r.mr_iid === iid &&
            r.head_sha === head &&
            r.status === "done" &&
            r.result?.review?.ownItems,
        )
        .at(-1)?.result.review.ownItems ?? null
    );
  }
  async latestJob(pid, iid) {
    return (
      this.rows
        .filter(
          (r) =>
            r.project_id === pid && r.mr_iid === iid && r.status !== "skipped",
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
        mr_iid: job.mr_iid,
        head_sha: job.head_sha,
        context_key: key,
        status,
        reason,
        job: structuredClone(job),
        created_at: ++this.clock,
      };
      this.rows.push(run);
      return { run, created: true };
    }
    if (shouldReopen(ex, job)) {
      Object.assign(ex, { status, reason, job: structuredClone(job) });
      return { run: ex, created: false, reopened: true };
    }
    return { run: ex, created: false };
  }
  async queuePosition() {
    return 1;
  }
  async setStatus() {}
}

test("intake pairs, keys on paired heads, and re-reviews the other half once", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-"));
  fs.writeFileSync(
    path.join(dir, "review.yaml"),
    "defaults:\n  related:\n    paths: [g]\n",
  );
  const configStore = new ConfigStore(path.join(dir, "review.yaml"), quiet);
  const db = new MemDb();
  const sent = [];
  const publish = async (q, m) => sent.push(m);
  const mrs = [
    {
      project_id: 1,
      iid: 3,
      source_branch: "feature/QES-1",
      target_branch: "prod",
      title: "web",
      description: "",
      web_url: "w",
      diff_refs: { base_sha: sha("a"), head_sha: sha("1") },
    },
    {
      project_id: 2,
      iid: 7,
      source_branch: "feature/QES-1",
      target_branch: "prod",
      title: "core",
      description: "",
      web_url: "c",
      diff_refs: { base_sha: sha("a"), head_sha: sha("5") },
    },
  ];
  const gitlab = fakeGitlab({ projects: [P(1, "g/web"), P(2, "g/core")], mrs });
  const job = (pid, ppath, iid, head) => ({
    project_id: pid,
    project_path: ppath,
    mr_iid: iid,
    source_branch: "feature/QES-1",
    target_branch: "prod",
    base_sha: sha("a"),
    head_sha: head,
  });
  const ctx = { configStore, db, publish, gitlab, log: quiet };

  // Core MR reviewed first (web has no review yet, so nothing to re-review).
  const c1 = await intake(job(2, "g/core", 7, sha("5")), ctx);
  assert.equal(c1.status, "queued");
  assert.deepEqual(
    c1.paired.map((p) => `${p.path}!${p.mr_iid}`),
    ["g/web!3"],
  );
  assert.equal(c1.rereviews.length, 0);

  // Web MR arrives: paired with core, and core is re-reviewed against web's head.
  const w1 = await intake(job(1, "g/web", 3, sha("1")), ctx);
  assert.equal(w1.status, "queued");
  assert.deepEqual(
    w1.rereviews.map((r) => `${r.project_path}!${r.mr_iid}:${r.status}`),
    ["g/core!7:duplicate"],
  );

  // Same web webhook again: duplicate, no re-review.
  assert.equal(
    (await intake(job(1, "g/web", 3, sha("1")), ctx)).status,
    "duplicate",
  );

  // Web pushes a new head: web queued; core re-reviewed once (its key moved).
  mrs[0].diff_refs.head_sha = sha("2");
  const w2 = await intake(job(1, "g/web", 3, sha("2")), ctx);
  assert.equal(w2.status, "queued");
  assert.deepEqual(
    w2.rereviews.map((r) => `${r.project_path}!${r.mr_iid}:${r.status}`),
    ["g/core!7:queued"],
  );
  const coreRows = db.rows.filter((r) => r.project_id === 2);
  assert.equal(coreRows.length, 2);
  assert.notEqual(coreRows[0].context_key, coreRows[1].context_key);
  assert.equal(coreRows[1].job.paired[0].head_sha, sha("2"));
});

// --- discovery and split items ---------------------------------------------

const FULLSTACK = () => [
  {
    project_id: 136,
    iid: 36,
    source_branch: "fix/bug-20261115",
    target_branch: "prod",
    title: "Fix batch of reported bugs",
    description: "Bug fixes: QES-1, QES-2 (this repo's share).",
    web_url: "https://g/core/-/merge_requests/36",
    diff_refs: { base_sha: sha("a"), head_sha: sha("c") },
  },
  {
    project_id: 135,
    iid: 69,
    source_branch: "fix/bug-20261115",
    target_branch: "prod",
    title: "Fix batch of reported bugs",
    description: "Bug fixes: QES-1, QES-2 (this repo's share).",
    web_url: "https://g/web/-/merge_requests/69",
    diff_refs: { base_sha: sha("a"), head_sha: sha("e") },
  },
  {
    project_id: 137,
    iid: 5,
    source_branch: "fix/bug-20261115",
    target_branch: "prod",
    title: "Unrelated",
    description: "other work",
    web_url: "u",
    diff_refs: { base_sha: sha("a"), head_sha: sha("f") },
  },
];
const QPROJ = [
  P(136, "internal/qestor/qestor-core"),
  P(135, "internal/qestor/qestor-web"),
  P(137, "internal/other/thing"),
  P(138, "internal/qestor/qestor-desktop"),
];
const webJob = (over = {}) => ({
  project_id: 135,
  project_path: "internal/qestor/qestor-web",
  mr_iid: 69,
  source_branch: "fix/bug-20261115",
  target_branch: "prod",
  base_sha: sha("a"),
  head_sha: sha("e"),
  qestor_items: [{ public_id: "QES-1" }, { public_id: "QES-2" }],
  ...over,
});

test("discoverPairs: same branch and a shared Qestor item, never self, never generic branches", async () => {
  const { discoverPairs } = await import("../src/pairing.js");
  const gitlab = fakeGitlab({ projects: QPROJ, mrs: FULLSTACK() });
  const found = await discoverPairs({ job: webJob(), cfg: cfg(), gitlab });
  assert.deepEqual(
    found.map((p) => `${p.path}!${p.mr_iid}`),
    ["internal/qestor/qestor-core!36"],
  );
  assert.equal(found[0].head_sha, sha("c"));
  assert.equal(found[0].discovered, true);
  assert.deepEqual(
    await discoverPairs({
      job: webJob({ source_branch: "main" }),
      cfg: cfg(),
      gitlab,
    }),
    [],
  );
  assert.deepEqual(
    await discoverPairs({
      job: webJob({ qestor_items: [] }),
      cfg: cfg(),
      gitlab,
    }),
    [],
  );
  assert.equal(
    (
      await discoverPairs({
        job: webJob({ qestor_items: [] }),
        cfg: cfg("defaults:\n  related:\n    discover: same_branch\n"),
        gitlab,
      })
    ).length,
    2,
  );
  assert.deepEqual(
    await discoverPairs({
      job: webJob(),
      cfg: cfg('defaults:\n  related:\n    discover: "off"\n'),
      gitlab,
    }),
    [],
  );
  assert.deepEqual(
    await discoverPairs({
      job: webJob(),
      cfg: cfg('defaults:\n  related:\n    allowed: ["internal/other/**"]\n'),
      gitlab,
    }),
    [],
  );
});

test("mergePairedItems: an item done by the paired MR counts as done here", async () => {
  const { mergePairedItems } = await import("../src/review.js");
  const { normalizeReview } = await import("../src/verdict.js");
  const items = [
    { public_id: "QES-1", title: "[FE] a" },
    { public_id: "QES-2", title: "[BE] b" },
    { public_id: "QES-3", title: "c" },
  ];
  const r = normalizeReview(
    {
      match: {
        items: [
          { public_id: "QES-1", status: "done", explanation: "grid" },
          { public_id: "QES-2", status: "missing", explanation: "no BE here" },
          { public_id: "QES-3", status: "missing", explanation: "nowhere" },
        ],
        explanation: "",
      },
      regression: { risk: "none", explanation: "", affected: [] },
      blockers: [],
      potentialBugs: [],
      recommendations: [],
    },
    { items },
  );
  mergePairedItems(r, [
    {
      path: "g/core",
      mr_iid: 36,
      mr_url: "https://g/core/-/merge_requests/36",
      peer_items: [
        {
          public_id: "QES-2",
          status: "done",
          explanation: "migration skips trash",
        },
        { public_id: "QES-3", status: "missing", explanation: "" },
      ],
    },
  ]);
  assert.deepEqual(
    r.match.items.map((v) => v.status),
    ["done", "done", "missing"],
  );
  assert.match(
    r.match.items[1].explanation,
    /Done in the paired MR \[!36\]\(https:\/\/g\/core\/-\/merge_requests\/36\) in `g\/core`: migration skips trash/,
  );
  assert.equal(r.match.aligned, false);
  // Own verdicts are kept first-hand, before the merge.
  assert.deepEqual(
    r.ownItems.map((v) => v.status),
    ["done", "missing", "missing"],
  );
});

test("contextKey changes when the paired MR's own verdicts change", () => {
  const p = { path: "g/core", head_sha: sha("c") };
  assert.notEqual(
    contextKey([p]),
    contextKey([{ ...p, peer_done: ["QES-2"] }]),
  );
  assert.equal(
    contextKey([{ ...p, peer_done: ["QES-2", "QES-1"] }]),
    contextKey([{ ...p, peer_done: ["QES-1", "QES-2"] }]),
  );
});

test("split card: first side sees the other's verdicts after it is reviewed; refresh stops when nothing changes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-"));
  fs.writeFileSync(path.join(dir, "review.yaml"), "{}");
  const configStore = new ConfigStore(path.join(dir, "review.yaml"), quiet);
  const db = new MemDb();
  const gitlab = fakeGitlab({ projects: QPROJ, mrs: FULLSTACK() });
  const ctx = { configStore, db, publish: async () => {}, gitlab, log: quiet };
  const coreJob = {
    ...webJob(),
    project_id: 136,
    project_path: "internal/qestor/qestor-core",
    mr_iid: 36,
    head_sha: sha("c"),
  };

  // Core first: discovered web, but web has no review yet.
  const c1 = await intake(coreJob, ctx);
  assert.equal(c1.status, "queued");
  assert.deepEqual(
    c1.paired.map((p) => `${p.path}!${p.mr_iid}`),
    ["internal/qestor/qestor-web!69"],
  );
  const coreRun = db.rows.find((r) => r.project_id === 136);
  assert.equal(coreRun.job.paired[0].peer_done, undefined);
  coreRun.status = "done";
  coreRun.result = {
    review: {
      ownItems: [
        { public_id: "QES-1", status: "missing" },
        { public_id: "QES-2", status: "done" },
      ],
    },
  };

  // Web second: it sees core's own verdict (QES-2 done) in its pairing snapshot.
  const w1 = await intake(webJob(), ctx);
  assert.equal(w1.status, "queued");
  const webRun = db.rows.find((r) => r.project_id === 135);
  assert.deepEqual(webRun.job.paired[0].peer_done, ["QES-2"]);
  webRun.status = "done";
  webRun.result = {
    review: {
      ownItems: [
        { public_id: "QES-1", status: "done" },
        { public_id: "QES-2", status: "missing" },
      ],
    },
  };

  // Refresh core after web finished: its key now includes web's verdicts, so it re-runs.
  const c2 = await intake(coreJob, { ...ctx, depth: 1 });
  assert.equal(c2.status, "queued");
  const coreRun2 = db.rows.filter((r) => r.project_id === 136).at(-1);
  assert.deepEqual(coreRun2.job.paired[0].peer_done, ["QES-1"]);
  coreRun2.status = "done";
  coreRun2.result = { review: { ownItems: coreRun.result.review.ownItems } };

  // Refresh web after core's second run: core's own verdicts didn't change -> duplicate, chain stops.
  assert.equal(
    (await intake(webJob(), { ...ctx, depth: 1 })).status,
    "duplicate",
  );
});

test("max_runs_per_head caps refreshes of one head", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cap-"));
  fs.writeFileSync(
    path.join(dir, "review.yaml"),
    "defaults:\n  runtime:\n    max_runs_per_head: 2\n",
  );
  const configStore = new ConfigStore(path.join(dir, "review.yaml"), quiet);
  const db = new MemDb();
  const mrs = FULLSTACK();
  const gitlab = fakeGitlab({ projects: QPROJ, mrs });
  const ctx = {
    configStore,
    db,
    publish: async () => {},
    gitlab,
    log: quiet,
    depth: 1,
  };
  const coreJob = {
    ...webJob(),
    project_id: 136,
    project_path: "internal/qestor/qestor-core",
    mr_iid: 36,
    head_sha: sha("c"),
  };
  const webRow = (own) =>
    db.rows.push({
      id: `w${db.rows.length}`,
      project_id: 135,
      mr_iid: 69,
      head_sha: sha("e"),
      context_key: `k${db.rows.length}`,
      status: "done",
      result: { review: { ownItems: own } },
      created_at: ++db.clock,
    });
  assert.equal((await intake(coreJob, ctx)).status, "queued");
  webRow([{ public_id: "QES-1", status: "done" }]);
  assert.equal((await intake(coreJob, ctx)).status, "queued");
  webRow([{ public_id: "QES-2", status: "done" }]);
  assert.equal((await intake(coreJob, ctx)).status, "capped");
});

test("merged, closed or outdated-head MRs are never reviewed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "st-"));
  fs.writeFileSync(path.join(dir, "review.yaml"), "{}");
  const configStore = new ConfigStore(path.join(dir, "review.yaml"), quiet);
  const mrs = [
    {
      project_id: 1,
      iid: 3,
      state: "merged",
      sha: sha("1"),
      source_branch: "s",
      diff_refs: {},
    },
    {
      project_id: 1,
      iid: 4,
      state: "opened",
      sha: sha("9"),
      source_branch: "s",
      diff_refs: {},
    },
  ];
  const gitlab = {
    ...fakeGitlab({ projects: PROJECTS, mrs }),
    mr: async (pid, iid) =>
      mrs.find((m) => m.project_id === pid && m.iid === iid) ?? null,
  };
  const db = new MemDb();
  const ctx = { configStore, db, publish: async () => {}, gitlab, log: quiet };
  const j = (iid, head) => ({
    project_id: 1,
    project_path: "g/web",
    mr_iid: iid,
    source_branch: "s",
    target_branch: "prod",
    base_sha: sha("a"),
    head_sha: head,
  });
  assert.deepEqual(await intake(j(3, sha("1")), ctx), {
    status: "skipped",
    reason: "MR is merged",
  });
  assert.match(
    (await intake(j(4, sha("1")), ctx)).reason,
    /not the MR's current head/,
  );
  assert.equal(db.rows.length, 0);
  assert.equal((await intake(j(4, sha("9")), ctx)).status, "queued");
});

test("pairing errors never block the review", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pe-"));
  fs.writeFileSync(
    path.join(dir, "review.yaml"),
    "defaults:\n  related:\n    paths: [g/core]\n",
  );
  const configStore = new ConfigStore(path.join(dir, "review.yaml"), quiet);
  const broken = {
    project: async () => {
      throw new Error("GitLab down");
    },
  };
  const r = await intake(
    {
      project_id: 1,
      project_path: "g/web",
      mr_iid: 3,
      source_branch: "s",
      target_branch: "prod",
      base_sha: sha("a"),
      head_sha: sha("1"),
    },
    {
      configStore,
      db: new MemDb(),
      publish: async () => {},
      gitlab: broken,
      log: quiet,
    },
  );
  assert.equal(r.status, "queued");
  assert.deepEqual(r.paired, []);
});
