import { redactSecrets } from './guardrails.js';

// Code suggestions. A `diff` on a finding or recommendation is only kept when
// it proposes a real change to real code, checked against the file at head:
//   - `-` and context lines must be a contiguous block in the file (the
//     "before" code exists),
//   - the result must differ from what is there,
//   - an addition (`+` only) must add code the file doesn't have, and carry
//     context lines that say where it goes.
// Common model sloppiness is repaired first: a `+` line identical to a `-`
// line is a quote (removed), and `+` lines that are really the unchanged
// lines just before/after the replaced block become context.
// Anything else (quoting the criticised line back, invented "before" code,
// no-ops, no file, redacted placeholders) is dropped. A kept suggestion
// carries `replace`, which line comments turn into a GitLab ```suggestion
// block the author can apply in one click.

const MAX_LINES = 40;

function parse(diff) {
  const out = [];
  for (const raw of String(diff ?? '').split('\n')) {
    if (raw.startsWith('+')) out.push({ t: '+', s: raw.slice(1) });
    else if (raw.startsWith('-')) out.push({ t: '-', s: raw.slice(1) });
    else if (raw.startsWith(' ')) out.push({ t: ' ', s: raw.slice(1) });
    else if (raw.trim() === '') out.push({ t: ' ', s: '' });
  }
  return trimBlankContext(out);
}

function trimBlankContext(rows) {
  const out = [...rows];
  while (out.length && out[0].s.trim() === '' && out[0].t !== '-') out.shift();
  while (out.length && out.at(-1).s.trim() === '' && out.at(-1).t !== '-') out.pop();
  return out;
}

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// Finds `before` (lines) as a contiguous block in `fileLines` (normalized),
// preferring the match nearest `nearLine` (1-based). Returns a 0-based index or -1.
function findBlock(fileNorm, before, nearLine = 0) {
  const want = before.map(norm);
  if (!want.length || want.every((w) => !w)) return -1;
  let best = -1;
  for (let i = 0; i + want.length <= fileNorm.length; i++) {
    let ok = true;
    for (let j = 0; j < want.length && ok; j++) ok = fileNorm[i + j] === want[j];
    if (ok && (best === -1 || Math.abs(i + 1 - nearLine) < Math.abs(best + 1 - nearLine))) best = i;
  }
  return best;
}

const render = (rows) => rows.map((r) => `${r.t}${r.s}`).join('\n');

// Returns null (drop the diff) or { diff, replace } where replace is
// { startLine, count, lines } (1-based, lines that replace `count` lines).
export function checkSuggestion(diff, { fileLines, line = 0 } = {}) {
  let rows = parse(diff);
  if (!rows.length || rows.length > MAX_LINES * 2 || !fileLines) return null;
  // We never suggest code built on redacted text.
  if (rows.some((r) => r.t === '+' && r.s.includes('[redacted'))) return null;
  // The model saw redacted text, so compare against the redacted file.
  const fileNorm = fileLines.map((l) => norm(redactSecrets(l).text));

  // A `+` line identical to a `-` line is a quote of the old code, not a change.
  // If every `+` line just echoes a `-` line, the diff is a no-op.
  const minusSet = new Set(rows.filter((r) => r.t === '-').map((r) => norm(r.s)));
  const hadPlus = rows.some((r) => r.t === '+');
  rows = rows.filter((r) => !(r.t === '+' && minusSet.has(norm(r.s))));
  if (hadPlus && !rows.some((r) => r.t === '+')) return null;
  const minus = rows.filter((r) => r.t === '-');
  const plus = rows.filter((r) => r.t === '+');
  if (!plus.length && !minus.length) return null;

  if (!minus.length) {
    // An addition: must add something new, and say where (context lines).
    const have = new Set(fileNorm.filter(Boolean));
    const added = plus.map((r) => norm(r.s)).filter(Boolean);
    if (!added.length || added.every((a) => have.has(a))) return null;
    const context = rows.filter((r) => r.t === ' ').map((r) => r.s);
    if (!context.some((c) => norm(c))) return null;
    const at = findBlock(fileNorm, context, line);
    if (at === -1) return null;
    return { diff: render(rows), replace: { startLine: at + 1, count: context.length, lines: rows.map((r) => r.s) } };
  }

  // Replacement: locate the before-block (context + `-`).
  const firstMinus = rows.findIndex((r) => r.t === '-');
  const lastMinus = rows.length - 1 - [...rows].reverse().findIndex((r) => r.t === '-');
  const core = rows.slice(firstMinus, lastMinus + 1);
  let lead = rows.slice(0, firstMinus);
  let trail = rows.slice(lastMinus + 1);
  const coreBefore = core.filter((r) => r.t !== '+').map((r) => r.s);
  let at = findBlock(fileNorm, [...lead.filter((r) => r.t === ' ').map((r) => r.s), ...coreBefore], line);
  if (at === -1) {
    // Leading `+` lines may be the unchanged lines just above the block.
    at = findBlock(fileNorm, coreBefore, line);
    if (at === -1) return null;
  }
  // Repair: leading/trailing `+` (or context) rows that equal the file lines
  // right next to the core block are unchanged context, not additions.
  const coreAt = findBlock(fileNorm, coreBefore, line);
  if (coreAt !== -1) {
    const fixedLead = [];
    let k = coreAt - 1;
    for (let i = lead.length - 1; i >= 0; i--) {
      if (k >= 0 && norm(lead[i].s) === fileNorm[k]) {
        fixedLead.unshift({ t: ' ', s: lead[i].s });
        k--;
      } else if (lead[i].t === ' ') return null; // context that isn't there
      else fixedLead.unshift(lead[i]); // a real addition above the block
    }
    lead = fixedLead;
    const after = coreAt + coreBefore.length;
    let m = after;
    trail = trail.map((r) => {
      if (m < fileNorm.length && norm(r.s) === fileNorm[m]) {
        m++;
        return { t: ' ', s: r.s };
      }
      return r;
    });
    at = coreAt - lead.filter((r) => r.t === ' ').length;
  }
  rows = trimBlankContext([...lead, ...core, ...trail]);
  const before = rows.filter((r) => r.t !== '+').map((r) => r.s);
  const result = rows.filter((r) => r.t !== '-').map((r) => r.s);
  if (before.map(norm).join('\n') === result.map(norm).join('\n')) return null;
  const start = findBlock(fileNorm, before, line);
  if (start === -1) return null;
  return { diff: render(rows), replace: { startLine: start + 1, count: before.length, lines: result } };
}

// GitLab suggestion block for a comment anchored on `startLine`: replaces
// that line and the next count-1 lines with `lines`.
export function suggestionBlock(replace) {
  const fence = replace.lines.some((l) => /^\s*```/.test(l)) ? '````' : '```';
  return `${fence}suggestion:-0+${replace.count - 1}\n${replace.lines.join('\n')}\n${fence}`;
}
