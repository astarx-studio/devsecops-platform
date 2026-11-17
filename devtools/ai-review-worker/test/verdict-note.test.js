import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeReview,
  applyItemPolicy,
  checkLocations,
  decideApproval,
  dropSpeculative,
  markUnverified,
} from "../src/verdict.js";
import {
  renderReviewNote,
  renderQestorNotice,
  formatCode,
  MARKER,
} from "../src/note.js";
import { parseConfigText, resolveProject } from "../src/config.js";
import { itemsText } from "../src/loop.js";
import { validateJob } from "../src/worker.js";

const cfg = (yaml = "{}") => resolveProject(parseConfigText(yaml), "g/p");
const finding = (over = {}) => ({
  title: "Bug",
  file: "src/a.js",
  line: 3,
  detail: "d",
  suggestion: "s",
  diff: "",
  ...over,
});
const clean = (items = []) => ({
  match: { items, explanation: "" },
  regression: { risk: "none", explanation: "", affected: [] },
  blockers: [],
  potentialBugs: [],
  recommendations: [],
});
const ITEMS = [
  { public_id: "QES-1", title: "One", url: "https://q/i/QES-1" },
  { public_id: "QES-2", title: "Two", url: "https://q/i/QES-2" },
];
const verdicts = (a, b) => [
  { public_id: "QES-1", status: a, explanation: "x" },
  { public_id: "QES-2", status: b, explanation: "y" },
];
const judge = (raw, c, items = ITEMS) =>
  applyItemPolicy(normalizeReview(raw, { items }), c);

test("approve only with no blockers, no potential bugs, every item done", () => {
  const c = cfg();
  assert.equal(
    decideApproval(judge(clean(verdicts("done", "done")), c), c, ["src/a.js"])
      .action,
    "approve",
  );
  assert.equal(
    decideApproval(
      judge(
        { ...clean(verdicts("done", "done")), potentialBugs: [finding()] },
        c,
      ),
      c,
      ["src/a.js"],
    ).action,
    "unapprove",
  );
  assert.equal(
    decideApproval(
      judge({ ...clean(verdicts("done", "done")), blockers: [finding()] }, c),
      c,
      ["src/a.js"],
    ).action,
    "unapprove",
  );
});

test("all_done: a partial or missing item becomes a blocker naming the item", () => {
  const c = cfg();
  const r = judge(clean(verdicts("done", "partial")), c);
  assert.equal(r.blockers.length, 1);
  assert.match(r.blockers[0].title, /`QES-2` is only partly implemented/);
  assert.equal(r.match.aligned, false);
  assert.equal(decideApproval(r, c, ["x"]).action, "unapprove");
});

test("an item the model skipped is not assessed, and blocks", () => {
  const c = cfg();
  const r = judge(
    clean([{ public_id: "QES-1", status: "done", explanation: "" }]),
    c,
  );
  assert.equal(r.match.items[1].status, "not_assessed");
  assert.match(r.blockers[0].title, /`QES-2` was not assessed/);
});

test('commits naming an item turn a "missing" verdict into "not confirmed" only when the diff was cut', () => {
  const c = cfg();
  const commits = {
    "QES-1": [
      {
        sha: "80d29bb",
        subject: "#QES-1: Open the form when Add Bug needs a field",
        files: ["src/a.tsx"],
      },
    ],
    "QES-2": [
      {
        sha: "b9c6f40",
        subject: "#QES-2: bump product version",
        files: ["package.json", "src/libs/product/version.ts"],
      },
    ],
  };
  const seen = normalizeReview(clean(verdicts("missing", "missing")), {
    items: ITEMS,
  });
  markUnverified(seen, commits, { truncated: false });
  assert.equal(seen.match.items[0].status, "missing");
  assert.equal(seen.match.items[1].status, "missing");

  const r = normalizeReview(clean(verdicts("missing", "missing")), {
    items: ITEMS,
  });
  markUnverified(r, commits, { truncated: true });
  assert.equal(r.match.items[0].status, "unverified");
  assert.match(
    r.match.items[0].explanation,
    /`80d29bb` #QES-1: Open the form.*the diff was cut to fit/,
  );
  assert.equal(r.match.items[1].status, "missing");
  applyItemPolicy(r, c);
  assert.equal(r.blockers.length, 1);
  assert.match(r.blockers[0].title, /`QES-2` is not addressed/);
  assert.equal(r.potentialBugs.length, 1);
  assert.match(
    r.potentialBugs[0].title,
    /`QES-1` is claimed by commits but not confirmed/,
  );
  assert.equal(decideApproval(r, c, ["x"]).action, "unapprove");
  const body = renderReviewNote({
    headSha: "a".repeat(40),
    review: r,
    decision: decideApproval(r, c, ["x"]),
    cfg: c,
    meta: {
      provider: "p",
      model: "m",
      contextTokens: 1,
      readRounds: 0,
      durationMs: 0,
      runId: "r",
    },
  });
  assert.match(
    body,
    /🔍 \[`QES-1`\]\(https:\/\/q\/i\/QES-1\) One — \*\*Not confirmed\*\*/,
  );
});

test("none_missing and any_done policies", () => {
  const nm = cfg("defaults:\n  approve:\n    item_match: none_missing\n");
  const r1 = judge(clean(verdicts("done", "partial")), nm);
  assert.equal(r1.blockers.length, 0);
  assert.equal(r1.potentialBugs.length, 1);
  const ad = cfg("defaults:\n  approve:\n    item_match: any_done\n");
  const r2 = judge(clean(verdicts("done", "missing")), ad);
  assert.equal(r2.blockers.length, 0);
  assert.equal(r2.recommendations.length, 1);
  assert.equal(decideApproval(r2, ad, ["x"]).action, "approve");
  const r3 = judge(clean(verdicts("missing", "missing")), ad);
  assert.equal(r3.blockers.length, 1);
});

test("no linked items: match is not judged and does not block", () => {
  const c = cfg();
  const r = judge(clean([]), c, []);
  assert.equal(r.blockers.length, 0);
  assert.equal(decideApproval(r, c, ["x"]).action, "approve");
});

test("protected paths are never approved; approval off gives none", () => {
  const r = judge(clean([]), cfg(), []);
  const d = decideApproval(r, cfg(), [".gitlab-ci.yml", "src/a.js"]);
  assert.equal(d.action, "unapprove");
  assert.match(d.reasons.join(), /never approves: `\.gitlab-ci\.yml`/);
  const off = cfg(
    "defaults:\n  approve:\n    enabled: false\n    unapprove_on_regression: false\n",
  );
  assert.equal(decideApproval(r, off, ["a"]).action, "none");
});

test("made-up locations are dropped, findings kept", async () => {
  const lookup = async (f) => (f === "src/a.js" ? 10 : null);
  const r = normalizeReview(
    {
      ...clean(),
      blockers: [
        finding(),
        finding({ file: "nope.js" }),
        finding({ line: 99 }),
      ],
    },
    { items: [] },
  );
  const out = await checkLocations(r.blockers, lookup);
  assert.equal(out[0].line, 3);
  assert.equal(out[1].file, "");
  assert.equal(out[1].locationDropped, true);
  assert.equal(out[2].line, 0);
});

test("diff fields are cleaned: fences and @@ headers removed, prefixes kept", () => {
  const r = normalizeReview(
    {
      ...clean(),
      blockers: [finding({ diff: "```diff\n@@ -1 +1 @@\n-a\n+b\nctx\n```" })],
    },
    { items: [] },
  );
  assert.equal(r.blockers[0].diff, "-a\n+b\n ctx");
});

test("formatCode wraps code outside spans, links and URLs only", () => {
  assert.equal(
    formatCode("call pageCount(count) in src/a.ts"),
    "call `pageCount(count)` in `src/a.ts`",
  );
  assert.equal(
    formatCode("the item_group_page and itemGroup"),
    "the `item_group_page` and `itemGroup`",
  );
  assert.equal(formatCode("already `done_here` ok"), "already `done_here` ok");
  assert.equal(
    formatCode("see [a.js](https://x/y/a.js#L1) and https://x/b/c.ts"),
    "see [a.js](https://x/y/a.js#L1) and https://x/b/c.ts",
  );
  assert.equal(
    formatCode("plain words stay plain."),
    "plain words stay plain.",
  );
  assert.equal(formatCode("```js\nfoo_bar()\n```"), "```js\nfoo_bar()\n```");
});

test("note: marker, per-item verdicts, diff blocks, formatted code, sections order", () => {
  const c = cfg();
  const raw = {
    ...clean(verdicts("done", "missing")),
    regression: {
      risk: "low",
      explanation: "touches parse_input",
      affected: [{ file: "src/b.js", line: 4, detail: "calls pageOf(items)" }],
    },
    potentialBugs: [
      finding({
        title: "slice end off by one",
        diff: "-  return a.slice(s, s + n - 1);\n+  return a.slice(s, s + n);",
      }),
    ],
    recommendations: [
      {
        text: "add a test for hasPage",
        file: "src/a.js",
        line: 3,
        diff: "+test()",
      },
    ],
  };
  const r = judge(raw, c);
  const d = decideApproval(r, c, ["src/a.js"]);
  const sha = "a".repeat(40);
  const body = renderReviewNote({
    headSha: sha,
    review: r,
    decision: d,
    cfg: c,
    meta: {
      provider: "p",
      model: "m",
      contextTokens: 16384,
      readRounds: 1,
      durationMs: 4000,
      runId: "r1",
      inlineCount: 2,
    },
    webBase: "https://g/x/-/blob/" + sha,
  });
  assert.equal(body.split("\n")[0], `${MARKER}${sha}:`);
  assert.match(
    body,
    /✅ \[`QES-1`\]\(https:\/\/q\/i\/QES-1\) One — \*\*Done\*\*/,
  );
  assert.match(
    body,
    /❌ \[`QES-2`\]\(https:\/\/q\/i\/QES-2\) Two — \*\*Not addressed\*\*/,
  );
  assert.match(body, /`QES-2` is not addressed/);
  assert.match(body, /touches `parse_input`/);
  assert.match(body, /calls `pageOf\(items\)`/);
  assert.match(
    body,
    /```diff\n {3}- {2}return a\.slice\(s, s \+ n - 1\);\n {3}\+ {2}return a\.slice\(s, s \+ n\);\n {3}```/,
  );
  assert.match(body, /add a test for `hasPage`|add a test for hasPage/);
  assert.match(body, /```diff\n {2}\+test\(\)\n {2}```/);
  assert.match(body, /inline comments: 2/);
  assert.ok(body.indexOf("### Match") < body.indexOf("### Blockers"));
});

test("findings in a related repo link into that repo; related repos section lists the pairing", () => {
  const c = cfg();
  const r = judge(
    {
      ...clean([]),
      blockers: [
        finding({
          repo: "g/core",
          file: "api/items.js",
          line: 2,
          title: "route renamed on the backend",
        }),
      ],
    },
    c,
    [],
  );
  r.relatedRepos = [
    {
      path: "g/core",
      mode: "mr",
      mr_iid: 7,
      mr_url: "https://g/g/core/-/merge_requests/7",
      how: "same source branch",
      head_sha: "c".repeat(40),
    },
    {
      path: "g/docs",
      mode: "branch",
      ref: "prod",
      how: "same target branch",
      head_sha: "d".repeat(40),
    },
  ];
  const webBase = (repo) =>
    repo === "g/core"
      ? "https://g/g/core/-/blob/" + "c".repeat(40)
      : repo
        ? ""
        : "https://g/g/web/-/blob/x";
  const body = renderReviewNote({
    headSha: "a".repeat(40),
    review: r,
    decision: decideApproval(r, c, ["src/a.js"]),
    cfg: c,
    meta: {
      provider: "p",
      model: "m",
      contextTokens: 1,
      readRounds: 0,
      durationMs: 0,
      runId: "r",
    },
    webBase,
  });
  assert.match(
    body,
    /### Related repositories\n- `g\/core`: paired MR \[!7\]\(https:\/\/g\/g\/core\/-\/merge_requests\/7\) \(same source branch\) at `cccccccccccc`\n- `g\/docs`: no paired MR, checked against `prod`/,
  );
  assert.match(
    body,
    /`g\/core` \[`api\/items\.js:2`\]\(https:\/\/g\/g\/core\/-\/blob\/c+\/api\/items\.js#L2\)/,
  );
  assert.ok(
    body.indexOf("### Related repositories") < body.indexOf("### Match"),
  );
});

test("Qestor notice lists reasons and top findings with a NOTE_URL link", () => {
  const c = cfg();
  const r = judge(
    {
      ...clean(verdicts("done", "partial")),
      potentialBugs: [finding({ title: "null access on item_id" })],
    },
    c,
  );
  const d = decideApproval(r, c, ["src/a.js"]);
  const job = {
    project_path: "g/p",
    mr_iid: 7,
    title: "Fix",
    web_url: "https://g/g/p/-/merge_requests/7",
    head_sha: "b".repeat(40),
  };
  const body = renderQestorNotice({ job, review: r, decision: d, cfg: c });
  assert.match(
    body,
    /AI review rejected merge request \[!7 Fix\]\(https:\/\/g\/g\/p\/-\/merge_requests\/7\)\*\* at `bbbbbbbbbbbb`/,
  );
  assert.match(body, /Blocker: `QES-2` is only partly implemented/);
  assert.match(body, /Potential bug: null access on `item_id`/);
  assert.match(body, /\]\(NOTE_URL\)/);
  assert.match(body, /ai-review g\/p!7 at bbbbbbbbbbbb/);
});

test("a hedged potential bug is dropped and the review can still approve", () => {
  const c = cfg();
  const r = normalizeReview(
    {
      ...clean(verdicts("done", "done")),
      potentialBugs: [
        finding({
          title: "ColumnToggle may not have i18n",
          detail:
            "ColumnToggle may not have i18n initialized if used standalone.",
        }),
      ],
    },
    { items: ITEMS },
  );
  dropSpeculative(r);
  assert.equal(r.potentialBugs.length, 0);
  assert.equal(
    decideApproval(applyItemPolicy(r, c), c, ["src/a.js"]).action,
    "approve",
  );
});

test("a potential bug that names a wrong result on a reached path is kept and unapproves", () => {
  const c = cfg();
  const r = normalizeReview(
    {
      ...clean(verdicts("done", "done")),
      potentialBugs: [
        finding({
          title: "Rejected rows still reach Finance Control",
          detail:
            "When a Business Unit row is rejected, `list()` still returns it because the status filter was removed.",
        }),
      ],
    },
    { items: ITEMS },
  );
  dropSpeculative(r);
  assert.equal(r.potentialBugs.length, 1);
  assert.equal(
    decideApproval(applyItemPolicy(r, c), c, ["src/a.js"]).action,
    "unapprove",
  );
});

test("a consider-adding-a-comment recommendation is dropped", () => {
  const r = normalizeReview(
    {
      ...clean([]),
      recommendations: [
        {
          text: "Consider adding a comment that explains the filter.",
          file: "",
          line: 0,
          diff: "",
        },
        {
          text: "Add a test that a rejected Business Unit row is absent from Finance Control, because the new filter has no check.",
          file: "src/a.js",
          line: 4,
          diff: "",
        },
      ],
    },
    { items: [] },
  );
  dropSpeculative(r);
  assert.equal(r.recommendations.length, 1);
  assert.match(r.recommendations[0].text, /rejected Business Unit row/);
});

test("an item-policy potential bug and a guardrail finding are kept", () => {
  const c = cfg();
  const r = normalizeReview(
    clean([{ public_id: "QES-1", status: "missing", explanation: "not seen" }]),
    { items: [ITEMS[0]] },
  );
  markUnverified(
    r,
    {
      "QES-1": [
        {
          sha: "80d29bb",
          subject: "#QES-1: fix the filter",
          files: ["src/a.js"],
        },
      ],
    },
    { truncated: true },
  );
  r.potentialBugs.push(
    finding({
      title: "Possible token committed",
      detail: "An added line looks like a credential.",
      guard: true,
    }),
  );
  dropSpeculative(r);
  applyItemPolicy(r, c);
  dropSpeculative(r);
  assert.equal(r.potentialBugs.filter((f) => f.forced).length, 1);
  assert.equal(r.potentialBugs.filter((f) => f.guard).length, 1);
  assert.equal(decideApproval(r, c, ["src/a.js"]).action, "unapprove");
});

test("itemsText prints description, custom fields, then comments oldest first, and a cut drops comments first", () => {
  const item = {
    public_id: "RF-BUG-178",
    title: "Rejected rows",
    url: "https://qestor.example/i/RF-BUG-178",
    description:
      "See ![shot](qestor-file:abc-def) the short description that stays.",
    fields: [
      {
        name: "Expected Result",
        text: "Rejected Business Unit rows must not appear in Finance Control.",
      },
    ],
    comments: [
      {
        at: "2026-11-01T00:00:00Z",
        author: "a",
        body: "OLDCOMMENT " + "x".repeat(2000),
      },
      {
        at: "2026-11-02T00:00:00Z",
        author: "b",
        body: "Newest comment wins: rows stay out of Finance Control.",
      },
    ],
    commits: [
      { sha: "abc123", subject: "RF-BUG-178 fix", files: ["src/a.ts"] },
    ],
  };
  const full = itemsText([item], 4000);
  assert.doesNotMatch(full, /qestor-file:/);
  const desc = full.indexOf("short description that stays");
  const field = full.indexOf("Expected Result");
  const old = full.indexOf("OLDCOMMENT");
  const newest = full.indexOf("Newest comment wins");
  const commit = full.indexOf("Commit abc123");
  assert.ok(
    desc >= 0 && desc < field && field < old && old < newest && newest < commit,
    full,
  );

  const cut = itemsText([item], 180);
  assert.match(cut, /short description that stays/);
  assert.match(cut, /Expected Result/);
  assert.match(cut, /Rejected Business Unit rows must not appear/);
  assert.match(cut, /Older comments were cut/);
  assert.doesNotMatch(cut, /OLDCOMMENT/);
  assert.ok(
    cut.indexOf("Expected Result") < cut.indexOf("Older comments were cut"),
  );
});

test("validateJob keeps text fields and comments and caps them", () => {
  const base = {
    project_id: 1,
    project_path: "g/p",
    mr_iid: 1,
    source_branch: "feature/x",
    target_branch: "prod",
    head_sha: "a".repeat(40),
  };
  const j = validateJob({
    ...base,
    qestor_items: [
      {
        public_id: "RF-BUG-178",
        title: "Rejected rows",
        url: "https://qestor.example/i/RF-BUG-178",
        description: "See ![shot](qestor-file:abc-def) the rule.",
        fields: [
          { name: "Expected Result", text: "rows must not appear" },
          { name: "", text: "dropped" },
          ...Array.from({ length: 50 }, (_, n) => ({
            name: `F${n}`,
            text: "t",
          })),
        ],
        comments: [
          { at: "2026-11-02T00:00:00Z", author: "b", body: "later" },
          {
            at: "2026-11-01T00:00:00Z",
            author: "a",
            body: "![shot](qestor-file:abc-def)",
          },
          ...Array.from({ length: 90 }, (_, n) => ({
            at: `2026-10-01T00:00:${String(n).padStart(2, "0")}Z`,
            author: "c",
            body: "c",
          })),
        ],
      },
    ],
  });
  const item = j.qestor_items[0];
  assert.match(item.description, /the rule/);
  assert.doesNotMatch(item.description, /qestor-file:/);
  assert.equal(item.fields.length, 40);
  assert.equal(item.fields[0].name, "Expected Result");
  assert.equal(item.comments.length, 80);
  assert.equal(item.comments[0].body, "later");
  assert.equal(item.comments.filter((c) => !c.body.trim()).length, 0);
});
