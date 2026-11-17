import { Repo } from "./git.js";
import { createProvider } from "./providers/index.js";
import { buildSystemPrompt, buildInitialMessage, reviewLoop } from "./loop.js";
import { estimateTokens } from "./tokens.js";
import {
  normalizeReview,
  applyItemPolicy,
  checkLocations,
  decideApproval,
  dropSpeculative,
  markUnverified,
} from "./verdict.js";
import {
  renderReviewNote,
  renderSimpleNote,
  renderQestorNotice,
  qestorDedupeKey,
} from "./note.js";
import { matchesAny } from "./globs.js";
import { parseDiff } from "./diffparse.js";
import { gatherRelated } from "./related.js";
import { planInlineComments } from "./inline.js";
import { gatherCrossRepo } from "./crossrepo.js";
import { checkSuggestion } from "./suggest.js";
import {
  redactSecrets,
  scanSecrets,
  scanInjection,
  sanitizeOutgoing,
  cleanExtras,
} from "./guardrails.js";

const hostOf = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return "";
  }
};

// Fetches a related project at its paired head (MR refs, or the baseline branch).
async function fetchRelated(p, env, deps) {
  const repo = deps.relatedRepoFactory
    ? deps.relatedRepoFactory(p)
    : new Repo({
        reposDir: env.AI_REVIEW_REPOS_DIR,
        projectId: p.id,
        projectPath: p.path,
        gitlabUrl: env.GITLAB_URL,
        token: env.AI_REVIEW_GITLAB_TOKEN,
      });
  if (p.mode === "mr")
    await repo.fetchShas({
      mrIid: p.mr_iid,
      targetBranch: p.target_branch,
      baseSha: p.base_sha,
      headSha: p.head_sha,
    });
  else await repo.fetchBranch(p.ref, p.head_sha);
  return repo;
}

function webBlobBase(job) {
  if (!job.web_url) return "";
  // https://host/group/project/-/merge_requests/12 -> https://host/group/project/-/blob/<sha>
  const m = String(job.web_url).match(/^(https?:\/\/.+?)\/-\/merge_requests\//);
  return m ? `${m[1]}/-/blob/${job.head_sha}` : "";
}

const noInline = { comments: [], fps: [], stale: "leave" };

// A full-stack item is split across the pair: each MR does its share. An item
// the paired MR's own review marked done at its current head counts as done
// here. `ownItems` keeps this review's first-hand verdicts; only those are
// shared with the other side, so the two never feed merged results back.
export function mergePairedItems(review, paired) {
  review.ownItems = review.match.items.map((v) => ({
    public_id: v.public_id,
    status: v.status,
    explanation: v.explanation,
  }));
  for (const v of review.match.items) {
    if (v.status === "done") continue;
    for (const p of paired) {
      const theirs = (p.peer_items ?? []).find(
        (x) => x.public_id === v.public_id && x.status === "done",
      );
      if (!theirs) continue;
      v.status = "done";
      v.via = { path: p.path, mr_iid: p.mr_iid, mr_url: p.mr_url };
      v.explanation = `Done in the paired MR [!${p.mr_iid}](${p.mr_url}) in \`${p.path}\`${theirs.explanation ? `: ${theirs.explanation}` : "."}`;
      break;
    }
  }
  review.match.aligned = review.match.items.every((v) => v.status === "done");
  return review;
}

// One review run. Returns the result message published to ai-review.results.
export async function reviewJob({
  job,
  runId,
  cfg,
  configStore,
  env,
  deps,
  signal,
}) {
  const started = Date.now();
  const artifacts = deps.artifacts;
  const meta = {
    provider: cfg.model.provider,
    model: cfg.model.model,
    contextTokens: cfg.model.context_tokens,
    readRounds: 0,
    durationMs: 0,
    runId,
  };
  const base = {
    run_id: runId,
    project_id: job.project_id,
    project_path: job.project_path,
    mr_iid: job.mr_iid,
    head_sha: job.head_sha,
    web_url: job.web_url || "",
    inline: noInline,
    qestor_notice: null,
  };

  // A missing base is GitLab still preparing the MR, not an empty diff.
  // `skipped` can be re-opened; `nothing_to_compare` is stored as done.
  if (!job.base_sha || !job.head_sha) {
    meta.durationMs = Date.now() - started;
    return {
      ...base,
      status: "skipped",
      approval: "none",
      note_body: renderSimpleNote(
        job.head_sha,
        "GitLab had not prepared the diff yet, so this commit was not reviewed. Not approved.",
        meta,
      ),
    };
  }
  if (job.base_sha === job.head_sha) {
    meta.durationMs = Date.now() - started;
    return {
      ...base,
      status: "nothing_to_compare",
      approval: "none",
      note_body: renderSimpleNote(
        job.head_sha,
        "Nothing to compare: the base and head commits are the same. Not approved.",
        meta,
      ),
    };
  }

  const repo = deps.repoFactory
    ? deps.repoFactory(job)
    : new Repo({
        reposDir: env.AI_REVIEW_REPOS_DIR,
        projectId: job.project_id,
        projectPath: job.project_path,
        gitlabUrl: env.GITLAB_URL,
        token: env.AI_REVIEW_GITLAB_TOKEN,
      });
  await repo.fetchShas({
    mrIid: job.mr_iid,
    targetBranch: job.target_branch,
    baseSha: job.base_sha,
    headSha: job.head_sha,
  });

  const changed = await repo.changedFiles(job.base_sha, job.head_sha);
  const reviewable = changed.filter(
    (f) => !matchesAny(f, cfg.standard.ignore_paths),
  );
  if (!reviewable.length) {
    meta.durationMs = Date.now() - started;
    const text = changed.length
      ? `Nothing to review: every changed file is in \`ignore_paths\` (${changed
          .slice(0, 5)
          .map((f) => `\`${f}\``)
          .join(", ")}). Not approved.`
      : "Nothing to compare: the diff is empty. Not approved.";
    return {
      ...base,
      status: "nothing_to_compare",
      approval: "none",
      note_body: renderSimpleNote(job.head_sha, text, meta),
    };
  }

  const stat = await repo.diffStat(job.base_sha, job.head_sha);
  let diff = await repo.diff(
    job.base_sha,
    job.head_sha,
    cfg.standard.ignore_paths,
  );
  if (Buffer.byteLength(diff) > cfg.loop.max_diff_bytes) {
    if (cfg.loop.on_diff_over_cap === "skip") {
      meta.durationMs = Date.now() - started;
      return {
        ...base,
        status: "skipped",
        approval: "none",
        note_body: renderSimpleNote(
          job.head_sha,
          `Diff is ${Buffer.byteLength(diff)} bytes, over \`max_diff_bytes\` ${cfg.loop.max_diff_bytes}. Not reviewed, not approved.`,
          meta,
        ),
      };
    }
    diff = diff.slice(0, cfg.loop.max_diff_bytes);
    meta.diffCapped = true;
  }
  await artifacts.put(runId, job, "diff.patch", diff);
  const files = parseDiff(diff);

  // Deterministic scans; the model can't remove what they find.
  const g = cfg.guardrails;
  const ignoreFile = (p) => matchesAny(p, cfg.standard.ignore_paths);
  const secretHits =
    g.secret_scan === "off" ? [] : scanSecrets(files, ignoreFile);
  const red = (t) =>
    g.redact_prompt ? redactSecrets(t).text : String(t ?? "");

  const related = await gatherRelated({
    repo,
    headSha: job.head_sha,
    files,
    cfg,
  });
  if (related.text)
    await artifacts.put(runId, job, "related.txt", related.text);

  const paired = Array.isArray(job.paired) ? job.paired : [];
  const cross = paired.length
    ? await gatherCrossRepo({
        paired,
        files,
        cfg,
        repoFor: (p) => fetchRelated(p, env, deps),
        log: deps.log,
      })
    : { text: "", repos: [], pairedDiffs: [] };
  if (cross.text)
    await artifacts.put(runId, job, "related-repos.txt", cross.text);
  const others = new Map(cross.repos.map((p) => [p.path, p]));

  // Commits in this MR, mapped to the linked items they name.
  const commits = repo.commitsWithFiles
    ? await repo.commitsWithFiles(job.base_sha, job.head_sha).catch(() => [])
    : [];
  const itemCommits = {};
  const items = (job.qestor_items ?? [])
    .filter((i) => i && (i.found ?? true) && i.public_id)
    .map((i) => {
      itemCommits[i.public_id] = commits.filter((c) =>
        c.subject.includes(i.public_id),
      );
      return { ...i, commits: itemCommits[i.public_id] };
    });
  // Injection scan: this MR's added lines, its text, the items, and the
  // paired MRs' added lines (raw, so our own prompt markup isn't scanned).
  const injectionHits =
    g.injection_scan === "off"
      ? []
      : [
          ...scanInjection({
            files: files.filter((f) => !ignoreFile(f.newPath)),
            extraTexts: [
              { where: "the MR title", text: job.title },
              { where: "the MR description", text: job.description },
              ...items.map((i) => ({
                where: `Qestor item \`${i.public_id}\``,
                text: [
                  i.title,
                  i.description,
                  ...(i.fields ?? []).map((f) => `${f.name}\n${f.text}`),
                  ...(i.comments ?? []).map((c) => c.body),
                ].join("\n"),
              })),
            ],
          }),
          ...cross.pairedDiffs.flatMap((d) =>
            scanInjection({
              files: parseDiff(d.diff).filter((f) => !ignoreFile(f.newPath)),
            }).map((h) => ({
              where: `paired MR !${d.mr_iid} in \`${d.path}\` (\`${h.file}:${h.line}\`)`,
              file: "",
              line: 0,
              sample: h.sample,
            })),
          ),
        ];

  const standard = [
    cfg.standard.standard_file,
    ...cfg.standard.extra_standard_files,
  ]
    .map((f) => configStore.readConfigFile(f))
    .filter(Boolean)
    .join("\n\n");
  const extras = [
    cleanExtras(cfg.standard.extra_instructions),
    job.review_extras,
  ]
    .filter(Boolean)
    .join("\n\n");
  meta.extras = Boolean(extras);
  const system = buildSystemPrompt(cfg, standard, red(extras));
  // Secrets never reach the model, local or cloud.
  const promptJob = {
    ...job,
    title: red(job.title),
    description: red(job.description),
  };
  const promptItems = items.map((i) => ({
    ...i,
    title: red(i.title),
    description: red(i.description),
    fields: (i.fields ?? []).map((f) => ({
      ...f,
      name: red(f.name),
      text: red(f.text),
    })),
    comments: (i.comments ?? []).map((c) => ({ ...c, body: red(c.body) })),
  }));
  const initial = buildInitialMessage({
    job: promptJob,
    items: promptItems,
    stat,
    diff: red(diff),
    related: red(related.text),
    repos: red(cross.text),
    cfg,
    systemTokens: estimateTokens(system),
  });
  meta.diffTruncated = initial.diffTruncated;
  meta.relatedTruncated = initial.relatedTruncated;
  meta.reposTruncated = initial.reposTruncated;

  const provider = deps.providerFactory
    ? deps.providerFactory(cfg.model)
    : createProvider(cfg.model, env);
  const { review: raw, readRounds } = await reviewLoop({
    provider,
    cfg,
    system,
    initial: initial.content,
    signal,
    readCtx: {
      repo,
      headSha: job.head_sha,
      cfg,
      qestorLookup: deps.qestorLookup,
      others,
    },
    onRound: (r) =>
      artifacts.put(
        runId,
        job,
        `round-${r.round}${r.repair ? "-repair" : ""}.json`,
        JSON.stringify(r, null, 2),
      ),
  });
  meta.readRounds = readRounds;

  const review = normalizeReview(raw, { items });
  review.relatedRepos = [
    ...paired.map((p) =>
      others.has(p.path)
        ? p
        : { ...p, mode: "error", error: "could not be fetched" },
    ),
  ];
  mergePairedItems(review, paired);
  markUnverified(review, itemCommits, {
    truncated: Boolean(meta.diffCapped || meta.diffTruncated),
  });
  const lookup = async (f, repoPath = "") => {
    const target = repoPath
      ? others.get(repoPath)
      : { repo, head_sha: job.head_sha };
    if (!target) return null;
    try {
      const e = await target.repo.entry(target.head_sha, f);
      return e && e.type === "blob"
        ? target.repo.lineCount(target.head_sha, f)
        : null;
    } catch {
      return null;
    }
  };
  const selfBlob = webBlobBase(job);
  const webBase = (repoPath) => {
    if (!repoPath) return selfBlob;
    const o = others.get(repoPath);
    return o?.web_url ? `${o.web_url}/-/blob/${o.head_sha}` : "";
  };
  review.blockers = await checkLocations(review.blockers, lookup);
  review.potentialBugs = await checkLocations(review.potentialBugs, lookup);
  review.recommendations = await checkLocations(review.recommendations, lookup);
  review.regression.affected = (
    await checkLocations(review.regression.affected, lookup)
  ).map((a) => (a.locationDropped ? { ...a, locationDropped: false } : a));

  // Keep a code suggestion only when it proposes a real change to real code
  // (checked against the file at head); otherwise drop the block.
  const fileCache = new Map();
  const fileLinesOf = async (file, repoPath = "") => {
    const key = `${repoPath}|${file}`;
    if (!fileCache.has(key)) {
      const target = repoPath
        ? others.get(repoPath)
        : { repo, head_sha: job.head_sha };
      fileCache.set(
        key,
        target
          ? target.repo
              .readLines(target.head_sha, file, 1, 1_000_000)
              .then((r) => r.lines)
              .catch(() => null)
          : Promise.resolve(null),
      );
    }
    return fileCache.get(key);
  };
  for (const f of [
    ...review.blockers,
    ...review.potentialBugs,
    ...review.recommendations,
  ]) {
    if (!f.diff) continue;
    const checked = f.file
      ? checkSuggestion(f.diff, {
          fileLines: await fileLinesOf(f.file, f.repo),
          line: f.line,
        })
      : null;
    f.diff = checked?.diff ?? "";
    f.replace = !f.repo ? (checked?.replace ?? null) : null;
  }
  dropSpeculative(review);
  applyItemPolicy(review, cfg);

  // Guardrail findings go first and can't be dropped by the model.
  const guardFindings = [
    ...secretHits.map((h) => ({
      sev: g.secret_scan,
      f: {
        repo: "",
        title: `Possible ${h.kind} committed`,
        file: h.file,
        line: h.line,
        detail:
          "An added line looks like a credential. It was redacted from this review and from what the model saw. It is in the branch history now.",
        suggestion:
          "Remove it, rotate the credential, and load it from configuration or a secret store instead.",
        diff: "",
        guard: true,
      },
    })),
    ...injectionHits.map((h) => ({
      sev: g.injection_scan,
      f: {
        repo: "",
        title: "Possible prompt injection aimed at the reviewer",
        file: h.file,
        line: h.line,
        detail: `Text in ${h.file ? `\`${h.file}:${h.line}\`` : h.where} reads like an instruction to an AI reviewer: \`${h.sample.replace(/`/g, "'")}\`. It does not change this review, and the bot won't approve while it is there.`,
        suggestion:
          "Remove the text, or reword it if it is a legitimate comment for humans.",
        diff: "",
        guard: true,
      },
    })),
  ];
  for (const { sev, f } of guardFindings.reverse())
    (sev === "block" ? review.blockers : review.potentialBugs).unshift(f);
  meta.guardCount = guardFindings.length;

  const changedLines = files.reduce(
    (n, f) =>
      n + f.hunks.reduce((m, h) => m + h.added.length + h.removed.length, 0),
    0,
  );
  const truncated = [
    meta.diffCapped || meta.diffTruncated ? "diff" : "",
    meta.reposTruncated ? "related repositories" : "",
  ]
    .filter(Boolean)
    .join(", ");
  const relatedFailed = paired
    .filter((p) => !others.has(p.path))
    .map((p) => `\`${p.path}\``)
    .join(", ");
  review.relatedUnmatched = job.related_unmatched ?? [];
  const decision = decideApproval(review, cfg, changed, {
    truncated,
    relatedFailed,
    changedLines,
    guardFindings: guardFindings.filter((x) => x.sev === "block").length,
    itemsIncomplete: job.qestor_items_incomplete,
  });

  // Everything posted goes through the output guardrails.
  const linkHosts = [...g.link_hosts, hostOf(env.GITLAB_URL)].filter(Boolean);
  const safe = (t, maxLength = g.max_note_chars) =>
    sanitizeOutgoing(t, { linkHosts, maxLength });
  const inline = planInlineComments({ review, files, job, cfg });
  for (const c of inline.comments) c.body = safe(c.body, 50000);
  meta.inlineCount = inline.comments.length;
  meta.durationMs = Date.now() - started;
  const note = safe(
    renderReviewNote({
      headSha: job.head_sha,
      review,
      decision,
      cfg,
      meta,
      webBase,
    }),
  );

  const n = cfg.qestor_notice;
  const qestor_notice =
    n.enabled && n.on_rejected && decision.action !== "approve" && items.length
      ? {
          item_ids: items.map((i) => i.public_id),
          body: safe(
            renderQestorNotice({ job, review, decision, cfg }),
            g.max_qestor_chars,
          ),
          dedupe_key: qestorDedupeKey(job),
        }
      : null;

  const result = {
    ...base,
    status: "done",
    approval: decision.action,
    reasons: decision.reasons,
    review,
    meta,
    note_body: note,
    inline,
    qestor_notice,
  };
  await artifacts.put(
    runId,
    job,
    "result.json",
    JSON.stringify(result, null, 2),
  );
  return result;
}
