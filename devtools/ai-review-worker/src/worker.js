import { shouldReopen } from "./db.js";
import { resolveProject } from "./config.js";
import { decideScope } from "./scope.js";
import { reviewJob } from "./review.js";
import { renderQueuedNote, renderSimpleNote } from "./note.js";
import { JOBS, RESULTS, DLQ } from "./queue.js";
import {
  resolveRelatedProjects,
  pairProjects,
  contextKey,
  relatedEntries,
  relatedMax,
  discoverPairs,
} from "./pairing.js";
import {
  cleanListHeader,
  cleanExtras,
  sanitizeOutgoing,
} from "./guardrails.js";
import { matchesAny } from "./globs.js";

const REQUIRED = [
  "project_id",
  "project_path",
  "mr_iid",
  "source_branch",
  "target_branch",
  "head_sha",
];

// Bump when review logic changes in a way that should re-review an MR on its
// next event (it's part of the run key, and of the per-head run cap).
export const LOGIC_VERSION = "2026-11-17.1";

export function validateJob(job) {
  if (!job || typeof job !== "object")
    throw new Error("job body must be a JSON object");
  const missing = REQUIRED.filter(
    (k) => job[k] === undefined || job[k] === null || job[k] === "",
  );
  if (missing.length) throw new Error(`job is missing ${missing.join(", ")}`);
  if (!/^[0-9a-f]{40}$/.test(job.head_sha))
    throw new Error("head_sha must be a 40-character SHA");
  if (job.base_sha && !/^[0-9a-f]{40}$/.test(job.base_sha))
    throw new Error("base_sha must be a 40-character SHA");
  const str = (v, max) => String(v ?? "").slice(0, max);
  const projectPath = String(job.project_path);
  if (
    !/^[\w.-]+(?:\/[\w.-]+)+$/.test(projectPath) ||
    projectPath.split("/").some((s) => s === "." || s === "..")
  )
    throw new Error("project_path is not a GitLab path");
  for (const k of ["source_branch", "target_branch"]) {
    if (
      String(job[k]).length > 255 ||
      /[\s~^:?*[\\\0]|\.\.|^-/.test(String(job[k]))
    )
      throw new Error(`${k} is not a valid branch name`);
  }
  if (job.start_sha && !/^[0-9a-f]{40}$/.test(job.start_sha))
    throw new Error("start_sha must be a 40-character SHA");
  return {
    ...job,
    project_id: Number(job.project_id),
    mr_iid: Number(job.mr_iid),
    title: str(job.title, 500),
    description: str(job.description, 50000),
    web_url: /^https:\/\/[^\s]+$/.test(String(job.web_url ?? ""))
      ? str(job.web_url, 500)
      : "",
    labels: Array.isArray(job.labels)
      ? job.labels
          .slice(0, 50)
          .map((l) =>
            str(typeof l === "string" ? l : (l?.title ?? l?.name ?? ""), 100),
          )
      : [],
    qestor_items: Array.isArray(job.qestor_items)
      ? job.qestor_items.slice(0, 30).map((i) => ({
          public_id: str(i?.public_id, 130),
          title: str(i?.title, 500),
          url: /^https:\/\/[^\s]+$/.test(String(i?.url ?? ""))
            ? str(i.url, 500)
            : "",
          description: str(i?.description, 20000).replace(
            /!\[[^\]]*\]\(qestor-file:[^)]*\)|qestor-file:[0-9a-f-]{8,}/gi,
            "",
          ),
          fields: Array.isArray(i?.fields)
            ? i.fields
                .map((f) => ({
                  name: str(f?.name, 200),
                  text: str(f?.text, 8000).replace(
                    /!\[[^\]]*\]\(qestor-file:[^)]*\)|qestor-file:[0-9a-f-]{8,}/gi,
                    "",
                  ),
                }))
                .filter((f) => f.name && f.text.trim())
                .slice(0, 40)
            : [],
          comments: Array.isArray(i?.comments)
            ? i.comments
                .map((c) => ({
                  at: str(c?.at, 40),
                  author: str(c?.author, 80),
                  body: str(c?.body, 8000).replace(
                    /!\[[^\]]*\]\(qestor-file:[^)]*\)|qestor-file:[0-9a-f-]{8,}/gi,
                    "",
                  ),
                }))
                .filter((c) => c.body.trim())
                .slice(0, 80)
            : [],
          found: i?.found !== false,
        }))
      : [],
    review_only: cleanListHeader(job.review_only),
    review_related: cleanListHeader(job.review_related),
    // X-Review-Related-Max: a whole number, or ignored (config applies).
    review_related_max: /^\s*\d{1,3}\s*$/.test(
      String(job.review_related_max ?? ""),
    )
      ? Number(job.review_related_max)
      : null,
    review_extras: cleanExtras(job.review_extras),
    qestor_items_incomplete:
      job.qestor_items_incomplete === true ||
      job.qestor_items_incomplete === "true",
  };
}

// Related repositories for this job: resolved projects and the paired change
// in each. A GitLab error never blocks the review; it just runs without them.
async function resolvePairing(job, cfg, gitlab, db, log) {
  const entries = relatedEntries(cfg, job);
  const max = relatedMax(cfg, job);
  if (!gitlab || max === 0) return { paired: [] };
  const paired = [];
  const errors = [];
  if (entries.length) {
    try {
      const resolved = await resolveRelatedProjects({
        entries,
        gitlab,
        selfPath: job.project_path,
        max: max * 4,
      });
      if (resolved.unmatched?.length)
        job.related_unmatched = resolved.unmatched;
      // related.allowed bounds what config or a webhook header can pull in.
      const projects = resolved
        .filter((p) => matchesAny(p.path, cfg.related.allowed))
        .slice(0, max);
      paired.push(...(await pairProjects({ projects, job, cfg, gitlab })));
    } catch (err) {
      errors.push(err.message);
    }
  }
  // The other half of a full-stack change, found by evidence (same branch
  // and a shared Qestor item) even when nothing is configured.
  try {
    for (const p of await discoverPairs({ job, cfg, gitlab })) {
      if (paired.length >= max) break;
      const i = paired.findIndex((x) => x.path === p.path);
      if (i === -1) paired.push(p);
      else if (paired[i].mode !== "mr") paired[i] = p; // an open MR beats a baseline branch
    }
  } catch (err) {
    errors.push(err.message);
  }
  // Snapshot each paired MR's own item verdicts at its head. They're part of
  // the run key and are merged into this review's item verdicts.
  for (const p of paired) {
    if (p.mode !== "mr" || !db.latestOwnItems) continue;
    const own = await db
      .latestOwnItems(p.id, p.mr_iid, p.head_sha)
      .catch(() => null);
    if (own) {
      p.peer_items = own;
      p.peer_done = own
        .filter((v) => v.status === "done")
        .map((v) => v.public_id);
    }
  }
  if (errors.length)
    log.error(
      `pairing for ${job.project_path}!${job.mr_iid}: ${errors.join("; ")}`,
    );
  return { paired, error: errors.join("; ") || undefined };
}

// POST /jobs. Decides scope with the live config, resolves related
// repositories, dedupes on (MR, head, paired heads), and enqueues. When the
// run is new, MRs paired with this one are re-reviewed against the new head.
const SHA40 = /^[0-9a-f]{40}$/;

// Copy base/start from a prepared merge request when the webhook snapshot
// had no base yet. Never replaces a base the caller already sent.
export function applyPreparedDiff(job, live) {
  const refs = live?.diff_refs;
  if (!refs?.base_sha || !SHA40.test(refs.base_sha) || job.base_sha)
    return false;
  const head = refs.head_sha || live.sha;
  if (head && head !== job.head_sha) return false;
  job.base_sha = refs.base_sha;
  if (!job.start_sha && refs.start_sha && SHA40.test(refs.start_sha))
    job.start_sha = refs.start_sha;
  return true;
}

export async function intake(
  body,
  {
    configStore,
    db,
    publish,
    gitlab = null,
    log = console,
    depth = 0,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    diffAttempts,
    diffWaitMs,
  },
) {
  const job = validateJob(body);
  delete job.paired;
  delete job.context_key;
  delete job.related_unmatched;
  // The Qestor lookup in n8n was rate limited or failed: keep the items the
  // MR had last time instead of reviewing it as if it had none.
  if (job.qestor_items_incomplete && db.latestJob) {
    const prev = await db
      .latestJob(job.project_id, job.mr_iid)
      .catch(() => null);
    const known = new Map(
      (prev?.qestor_items ?? []).map((i) => [i.public_id, i]),
    );
    for (const i of job.qestor_items) known.set(i.public_id, i);
    job.qestor_items = [...known.values()];
  }
  const file = configStore.load();
  const cfg = resolveProject(file, job.project_path);
  // Never review an MR that is no longer open, or an old head: the MR's
  // current state comes from GitLab, not from whoever sent the job.
  // diff_refs is null for a few seconds after the MR is opened. Queueing
  // that snapshot stores an empty base and the review reports "the base and
  // head commits are the same" even when the branch has commits.
  if (gitlab?.mr) {
    const attempts = job.base_sha ? 1 : (diffAttempts ?? 5);
    for (let i = 0; i < attempts; i++) {
      const live = await gitlab
        .mr(job.project_id, job.mr_iid)
        .catch(() => null);
      if (live?.state && live.state !== "opened")
        return { status: "skipped", reason: `MR is ${live.state}` };
      if (live?.sha && live.sha !== job.head_sha)
        return {
          status: "skipped",
          reason: `head ${job.head_sha.slice(0, 12)} is not the MR's current head ${live.sha.slice(0, 12)}`,
        };
      if (applyPreparedDiff(job, live) || job.base_sha) break;
      if (i < attempts - 1) await sleep(diffWaitMs ?? 2000);
    }
  }
  if (!job.base_sha)
    return {
      status: "not_ready",
      reason: "GitLab has not prepared the merge request diff yet",
    };
  const scope = decideScope(file, cfg, job);
  if (!scope.review) {
    job.context_key = "";
    const { run, created, reopened } = await db.upsertQueued(
      job,
      "skipped",
      scope.reason,
    );
    if (!created && !reopened)
      return {
        status: "duplicate",
        run_id: run.id,
        existing_status: run.status,
      };
    return { status: "skipped", run_id: run.id, reason: scope.reason };
  }
  const pairing = await resolvePairing(job, cfg, gitlab, db, log);
  job.paired = pairing.paired;
  if (pairing.error) job.pairing_error = pairing.error;
  // The review profile (logic version + model + context size) is part of the
  // run key and of the per-head cap: changing the model or its context
  // re-reviews an MR on its next event instead of answering "duplicate".
  const profile = `${LOGIC_VERSION}+${cfg.model.provider}/${cfg.model.model}@${cfg.model.context_tokens}`;
  job.logic_version = profile;
  job.context_key = contextKey(job.paired, profile);
  // Loop brakes, checked only when this event would create a new run:
  // a per-head cap (paired MRs refreshing each other) and an hourly
  // per-MR circuit breaker (any feedback path, across heads).
  const existing = db.get
    ? await db.get(job.project_id, job.mr_iid, job.head_sha, job.context_key)
    : null;
  if (!existing || shouldReopen(existing, job)) {
    if (
      db.countRuns &&
      (await db.countRuns(job.project_id, job.mr_iid, job.head_sha, profile)) >=
        cfg.runtime.max_runs_per_head
    ) {
      log.info(
        `intake: ${job.project_path}!${job.mr_iid} ${job.head_sha.slice(0, 12)} reached max_runs_per_head`,
      );
      return {
        status: "capped",
        reason: `already reviewed ${cfg.runtime.max_runs_per_head} times at this head`,
      };
    }
    if (
      db.runsLastHour &&
      (await db.runsLastHour(job.project_id, job.mr_iid)) >=
        cfg.runtime.max_runs_per_mr_per_hour
    ) {
      log.error(
        `intake: ${job.project_path}!${job.mr_iid} hit max_runs_per_mr_per_hour (${cfg.runtime.max_runs_per_mr_per_hour}); dropping until the hour rolls over`,
      );
      return {
        status: "throttled",
        reason: `more than ${cfg.runtime.max_runs_per_mr_per_hour} reviews of this MR in the last hour`,
      };
    }
  }
  const { run, created, reopened } = await db.upsertQueued(job, "queued");
  if (!created && !reopened)
    return { status: "duplicate", run_id: run.id, existing_status: run.status };
  try {
    await publish(JOBS, { run_id: run.id });
  } catch (err) {
    // Not in the queue: mark failed so the next webhook for this SHA re-opens it.
    await db.setStatus(run.id, "failed", {
      reason: `enqueue failed: ${err.message}`,
    });
    throw new Error(`enqueue failed: ${err.message}`);
  }
  const position = await db.queuePosition(run);

  // Re-review the other half. Their own pairing now sees this MR's new head,
  // so their key changes once; this MR's key doesn't change from that, so the
  // chain stops after one hop.
  const rereviews = [];
  if (cfg.related.rereview_paired && depth === 0) {
    for (const p of job.paired.filter((x) => x.mode === "mr")) {
      const prev = await db.latestJob(p.id, p.mr_iid);
      if (!prev) continue;
      const next = {
        ...prev,
        base_sha: p.base_sha,
        head_sha: p.head_sha,
        source_branch: p.source_branch ?? prev.source_branch,
        target_branch: p.target_branch ?? prev.target_branch,
      };
      try {
        const r = await intake(next, {
          configStore,
          db,
          publish,
          gitlab,
          log,
          depth: depth + 1,
        });
        rereviews.push({
          project_path: p.path,
          mr_iid: p.mr_iid,
          status: r.status,
          run_id: r.run_id,
        });
      } catch (err) {
        log.error(`re-review ${p.path}!${p.mr_iid}: ${err.message}`);
      }
    }
  }
  return {
    status: "queued",
    run_id: run.id,
    position,
    paired: job.paired.map((p) => ({
      path: p.path,
      mode: p.mode,
      mr_iid: p.mr_iid,
      ref: p.ref,
      head_sha: p.head_sha,
    })),
    rereviews,
    queued_note: cfg.note.queued_notice
      ? renderQueuedNote(job.head_sha, position)
      : "",
  };
}

const FINAL_STATUS = {
  done: "done",
  nothing_to_compare: "done",
  skipped: "skipped",
};

// Handles one delivery from ai-review.jobs. Always acks: retries are new
// messages, so a poison job can't loop forever.
export async function processDelivery(
  payload,
  { redelivered, configStore, db, publish, env, deps, log = console },
) {
  const run = await db.byId(payload.run_id);
  if (!run) return { outcome: "missing" };
  const resumable =
    run.status === "queued" || (run.status === "running" && redelivered);
  if (!resumable) return { outcome: "stale", status: run.status };

  const release = await db.lockReview();
  try {
    const file = configStore.load();
    const cfg = resolveProject(file, run.project_path);
    // Crash-loop guard: a run whose earlier attempts died without finishing
    // (worker crash, OOM) is redelivered with attempts already counted. Past
    // the retry budget it fails closed instead of crashing the worker again.
    if (
      redelivered &&
      run.status === "running" &&
      run.attempts > cfg.runtime.retry_count
    ) {
      const failed = {
        run_id: run.id,
        project_id: run.project_id,
        project_path: run.project_path,
        mr_iid: run.mr_iid,
        head_sha: run.head_sha,
        web_url: run.job.web_url || "",
        status: "failed",
        approval: cfg.approve.unapprove_on_regression ? "unapprove" : "none",
        error: "the review crashed the worker on every attempt",
        note_body: sanitizeOutgoing(
          renderSimpleNote(
            run.head_sha,
            `AI review stopped after ${run.attempts} attempt(s) that did not finish, so this commit is **not approved**.`,
          ),
          { linkHosts: cfg.guardrails.link_hosts },
        ),
      };
      await db.setStatus(run.id, "failed", {
        reason: failed.error,
        decision: failed.approval,
        result: failed,
      });
      await publish(RESULTS, failed);
      await publish(DLQ, { ...failed, job: run.job });
      log.error(
        `run ${run.id}: crash loop, failed closed after ${run.attempts} attempts`,
      );
      return { outcome: "failed" };
    }
    if (cfg.runtime.supersede_stale) {
      const newer = await db.newerRun(run);
      if (newer) {
        await db.setStatus(run.id, "superseded", {
          reason: `superseded by ${newer.head_sha}`,
        });
        log.info(`run ${run.id}: superseded by ${newer.head_sha}`);
        return { outcome: "superseded" };
      }
    }
    const running = await db.setStatus(run.id, "running", {
      incAttempts: true,
    });
    log.info(
      `run ${run.id}: ${run.project_path}!${run.mr_iid} ${run.head_sha} attempt ${running.attempts}`,
    );
    const ctrl = new AbortController();
    const timer = setTimeout(
      () =>
        ctrl.abort(
          new Error(`run timed out after ${cfg.runtime.run_timeout_s}s`),
        ),
      cfg.runtime.run_timeout_s * 1000,
    );
    try {
      const result = await Promise.race([
        reviewJob({
          job: run.job,
          runId: run.id,
          cfg,
          configStore,
          env,
          deps,
          signal: ctrl.signal,
        }),
        new Promise((_, reject) =>
          ctrl.signal.addEventListener(
            "abort",
            () => reject(ctrl.signal.reason),
            { once: true },
          ),
        ),
      ]);
      await db.setStatus(run.id, FINAL_STATUS[result.status] ?? "done", {
        decision: result.approval,
        result,
      });
      await publish(RESULTS, result);
      log.info(`run ${run.id}: ${result.status} approval=${result.approval}`);
      // Refresh the other half: its key includes our item verdicts, so it
      // re-runs only when they changed (capped by max_runs_per_head).
      if (
        result.status === "done" &&
        cfg.related.rereview_paired &&
        deps.gitlab
      ) {
        for (const p of (run.job.paired ?? []).filter((x) => x.mode === "mr")) {
          const prev = await db.latestJob(p.id, p.mr_iid).catch(() => null);
          if (!prev) continue;
          const mr = await deps.gitlab.mr(p.id, p.mr_iid).catch(() => null);
          if (!mr || mr.state !== "opened" || !mr.diff_refs?.head_sha) continue;
          const next = {
            ...prev,
            base_sha: mr.diff_refs.base_sha,
            start_sha: mr.diff_refs.start_sha,
            head_sha: mr.diff_refs.head_sha,
          };
          const r = await intake(next, {
            configStore,
            db,
            publish,
            gitlab: deps.gitlab,
            log,
            depth: 1,
          }).catch((e) => ({ status: `error: ${e.message}` }));
          log.info(
            `refresh ${p.path}!${p.mr_iid} after ${run.project_path}!${run.mr_iid}: ${r.status}`,
          );
        }
      }
      return { outcome: result.status };
    } catch (err) {
      log.error(`run ${run.id}: ${err.message}`);
      if (running.attempts <= cfg.runtime.retry_count) {
        await db.setStatus(run.id, "queued", {
          reason: `retry after: ${err.message}`,
        });
        await publish(JOBS, { run_id: run.id });
        return { outcome: "retry" };
      }
      const failed = {
        run_id: run.id,
        project_id: run.project_id,
        project_path: run.project_path,
        mr_iid: run.mr_iid,
        head_sha: run.head_sha,
        status: "failed",
        approval: cfg.approve.unapprove_on_regression ? "unapprove" : "none",
        error: err.message,
        note_body: sanitizeOutgoing(
          renderSimpleNote(
            run.head_sha,
            `AI review failed after ${running.attempts} attempt(s), so this commit is **not approved**.\n\nError: \`${String(err.message).replace(/`/g, "'").slice(0, 300)}\``,
          ),
          { linkHosts: cfg.guardrails.link_hosts },
        ),
      };
      await db.setStatus(run.id, "failed", {
        reason: err.message,
        decision: failed.approval,
        result: failed,
      });
      await publish(RESULTS, failed);
      await publish(DLQ, { ...failed, job: run.job });
      return { outcome: "failed" };
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await release();
  }
}
