import { matchesAny } from "./globs.js";

export const MISMATCH_BLOCKER_TITLE = "Change does not match the linked items";

const clean = (s, max = 2000) =>
  String(s ?? "")
    .replace(/\r/g, "")
    .trim()
    .slice(0, max);
const cleanDiff = (s) =>
  String(s ?? "")
    .replace(/\r/g, "")
    .replace(/^```[\w-]*\n?|\n?```\s*$/g, "")
    .replace(/```/g, "`​``")
    .split("\n")
    .filter((l) => !/^@@/.test(l))
    .map((l) => (/^[+\- ]/.test(l) ? l : l ? ` ${l}` : l))
    .join("\n")
    .replace(/^\n+|\n+$/g, "")
    .slice(0, 4000);

const fileOf = (f) =>
  clean(f, 400)
    .replace(/^\.?\//, "")
    .replace(/^[ab]\//, "");
const lineOf = (n) => (Number.isInteger(n) && n > 0 ? n : 0);

// `repo` is "" for this MR's repository, or a related project path.
const repoOf = (r) => clean(r, 300).replace(/^\/+|\/+$/g, "");

function normalizeFinding(f) {
  return {
    repo: repoOf(f?.repo),
    title: clean(f?.title, 200) || "Untitled finding",
    file: fileOf(f?.file),
    line: lineOf(f?.line),
    detail: clean(f?.detail),
    suggestion: clean(f?.suggestion),
    diff: cleanDiff(f?.diff),
  };
}

function normalizeRecommendation(r) {
  if (typeof r === "string")
    return { repo: "", text: clean(r, 800), file: "", line: 0, diff: "" };
  return {
    repo: repoOf(r?.repo),
    text: clean(r?.text, 800),
    file: fileOf(r?.file),
    line: lineOf(r?.line),
    diff: cleanDiff(r?.diff),
  };
}

const STATUS = ["done", "partial", "missing"];

// Every linked item gets exactly one verdict. Items the model skipped are
// marked not assessed, which counts as not done.
export function normalizeReview(review, { items = [] } = {}) {
  const byId = new Map();
  for (const it of review?.match?.items ?? []) {
    const id = clean(it?.public_id, 130);
    if (id && !byId.has(id))
      byId.set(id, {
        status: STATUS.includes(it?.status) ? it.status : "missing",
        explanation: clean(it?.explanation),
      });
  }
  const itemVerdicts = items.map((it) => {
    const v = byId.get(it.public_id);
    return {
      public_id: it.public_id,
      title: clean(it.title, 200),
      url: it.url || "",
      status: v ? v.status : "not_assessed",
      explanation: v ? v.explanation : "The review did not assess this item.",
    };
  });
  const r = {
    match: {
      items: itemVerdicts,
      explanation: clean(review?.match?.explanation),
      notJudged: items.length === 0,
      aligned: itemVerdicts.every((v) => v.status === "done"),
    },
    regression: {
      risk: ["none", "low", "medium", "high"].includes(review?.regression?.risk)
        ? review.regression.risk
        : "medium",
      explanation: clean(review?.regression?.explanation),
      affected: (review?.regression?.affected ?? [])
        .map((a) => ({
          repo: repoOf(a?.repo),
          file: fileOf(a?.file),
          line: lineOf(a?.line),
          detail: clean(a?.detail, 600),
        }))
        .filter((a) => a.file || a.detail),
    },
    blockers: (review?.blockers ?? []).map(normalizeFinding),
    potentialBugs: (review?.potentialBugs ?? []).map(normalizeFinding),
    recommendations: (review?.recommendations ?? [])
      .map(normalizeRecommendation)
      .filter((x) => x.text),
  };
  return r;
}

// Drops locations the model made up. `lookup(file, repo)` returns the line
// count of that file at that repo's head, or null when it doesn't exist (or
// the repo isn't one of the related ones). The finding is kept.
export async function checkLocations(findings, lookup) {
  const out = [];
  for (const f of findings) {
    const n = f.file
      ? await lookup(f.file, f.repo ?? "").catch(() => null)
      : null;
    if (n == null)
      out.push({
        ...f,
        repo: "",
        file: "",
        line: 0,
        locationDropped: Boolean(f.file),
      });
    else if (f.line < 1 || f.line > n)
      out.push({ ...f, line: 0, locationDropped: f.line !== 0 });
    else out.push(f);
  }
  return out;
}

const LABEL = {
  partial: "is only partly implemented",
  missing: "is not addressed",
  not_assessed: "was not assessed by the review",
  unverified: "is claimed by commits but not confirmed by the review",
};

// A hedge with no named wrong outcome is not a finding. Forced item-policy
// findings and guardrail findings stay.
const HEDGE =
  /\b(?:consider|verify|might|standalone|confidence|it would be good)\b|\bmay (?:not|if|be)\b|\badd a comment\b/i;
const OUTCOME =
  /\b(?:wrong|incorrect|fail(?:s|ed|ure)?|crash(?:es|ed)?|throw(?:s|n)?|omits?|missing|skips?|leak(?:s|ed)?|bypass(?:es|ed)?|corrupt(?:s|ed)?|deletes?|duplicates?|null|undefined|returns? the|not (?:shown|saved|persisted|included|applied|rejected|allowed))\b/i;

export function dropSpeculative(review) {
  const keep = (text, entry) =>
    entry?.forced ||
    entry?.guard ||
    !HEDGE.test(String(text || "")) ||
    OUTCOME.test(String(text || ""));
  review.potentialBugs = (review.potentialBugs ?? []).filter((f) =>
    keep(`${f.title}\n${f.detail}\n${f.suggestion}`, f),
  );
  review.recommendations = (review.recommendations ?? []).filter((r) =>
    keep(r.text, r),
  );
  return review;
}

// A commit that names an item is not proof the requirement is met. Only when
// the diff was cut can that commit turn "missing" into "unverified", because
// the review did not see the change. A fully seen miss stays "missing".
// `itemCommits` maps public_id -> [{ sha, subject, files }].
export function markUnverified(
  review,
  itemCommits,
  { truncated = false } = {},
) {
  if (!truncated) return review;
  for (const v of review.match.items) {
    if (v.status !== "missing" && v.status !== "not_assessed") continue;
    const commits = (itemCommits[v.public_id] ?? []).filter((c) =>
      c.files.some(
        (f) => !/(^|\/)(package(-lock)?\.json|version\.ts|VERSION)$/.test(f),
      ),
    );
    if (!commits.length) continue;
    v.status = "unverified";
    const list = commits
      .slice(0, 3)
      .map((c) => `\`${c.sha}\` ${c.subject}`)
      .join("; ");
    v.explanation = `Commits in this MR name this item (${list}), but the review could not confirm the change${truncated ? " (the diff was cut to fit, so part of it was not seen)" : ""}. Model's note: ${v.explanation}`;
  }
  review.match.aligned = review.match.items.every((v) => v.status === "done");
  return review;
}

function itemFinding(v) {
  return {
    title: `\`${v.public_id}\` ${LABEL[v.status]}`,
    file: "",
    line: 0,
    detail: `${v.title ? `${v.title}: ` : ""}${v.explanation}`,
    suggestion:
      v.status === "partial"
        ? "Finish what the item asks for, or split the rest into its own item."
        : v.status === "unverified"
          ? "A human should confirm the change in those commits, or split the MR so the review can see all of it."
          : "Implement what the item asks for, or unlink the item if this MR is not meant to cover it.",
    diff: "",
    forced: true,
  };
}

// Applies approve.item_match. Items that aren't done become findings, so they
// show in the note, count against approval, and reach the Qestor notice.
export function applyItemPolicy(review, cfg) {
  if (!cfg.approve.require_match || review.match.notJudged) {
    review.match.aligned = true;
    return review;
  }
  const policy = cfg.approve.item_match;
  // Unverified items are a potential bug whatever the policy: not proven
  // missing, so not a blocker, but not confirmed, so no approval.
  for (const v of review.match.items.filter((x) => x.status === "unverified"))
    review.potentialBugs.unshift(itemFinding(v));
  const notDone = review.match.items.filter(
    (v) => v.status !== "done" && v.status !== "unverified",
  );
  if (policy === "all_done") {
    for (const v of notDone) review.blockers.unshift(itemFinding(v));
    review.match.aligned =
      notDone.length === 0 &&
      review.match.items.every((v) => v.status !== "unverified");
  } else if (policy === "none_missing") {
    for (const v of notDone) {
      if (v.status === "partial") review.potentialBugs.unshift(itemFinding(v));
      else review.blockers.unshift(itemFinding(v));
    }
    review.match.aligned = notDone.every((v) => v.status === "partial");
  } else {
    const anyDone = review.match.items.some((v) => v.status === "done");
    if (!anyDone)
      review.blockers.unshift({
        ...itemFinding({ ...notDone[0], status: "missing" }),
        title: MISMATCH_BLOCKER_TITLE,
        detail:
          review.match.explanation ||
          "None of the linked items is done by this change.",
      });
    else
      for (const v of notDone)
        review.recommendations.push({
          text: `${itemFinding(v).title}: ${v.explanation}`,
          file: "",
          line: 0,
          diff: "",
        });
    review.match.aligned = anyDone;
  }
  return review;
}

// Returns { action: 'approve' | 'unapprove' | 'none', reasons: [] }.
// `guard` carries what the model can't change: truncation, failed related
// repos, change size, and guardrail findings.
export function decideApproval(review, cfg, changedFiles, guard = {}) {
  const a = cfg.approve;
  const reasons = [];
  if (!a.enabled) reasons.push("approval is turned off in config");
  if (a.never_when_truncated && guard.truncated)
    reasons.push(
      `the review did not see everything (${guard.truncated}), so it can't approve`,
    );
  if (a.never_when_related_failed && guard.relatedFailed)
    reasons.push(
      `a related repository could not be read (${guard.relatedFailed})`,
    );
  if (a.max_changed_lines > 0 && guard.changedLines > a.max_changed_lines)
    reasons.push(
      `the change is ${guard.changedLines} lines, over the ${a.max_changed_lines}-line limit for approval by the bot`,
    );
  if (guard.guardFindings)
    reasons.push(`guardrails flagged ${guard.guardFindings} issue(s)`);
  if (guard.itemsIncomplete)
    reasons.push(
      "the Qestor item lookup was incomplete (rate limited or failed), so the linked items may not all be known",
    );
  if (a.require_no_blockers && review.blockers.length)
    reasons.push(`${review.blockers.length} blocker(s)`);
  if (a.require_no_potential_bugs && review.potentialBugs.length)
    reasons.push(`${review.potentialBugs.length} potential bug(s)`);
  if (a.require_match && !review.match.aligned)
    reasons.push("the change does not complete every linked item");
  const guarded = changedFiles.filter((f) => matchesAny(f, a.never_on_paths));
  if (guarded.length)
    reasons.push(
      `touches paths the bot never approves: ${guarded
        .slice(0, 5)
        .map((f) => `\`${f}\``)
        .join(", ")}${guarded.length > 5 ? ", …" : ""}`,
    );
  if (reasons.length === 0) return { action: "approve", reasons };
  return { action: a.unapprove_on_regression ? "unapprove" : "none", reasons };
}
