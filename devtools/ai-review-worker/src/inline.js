import { positionFor, nearestDiffLine } from './diffparse.js';
import { fingerprint, renderInlineBody } from './note.js';
import { suggestionBlock } from './suggest.js';

const KIND_LIST = { blockers: 'blockers', potential_bugs: 'potentialBugs', recommendations: 'recommendations' };

// Every replaced line must be visible in the MR diff for GitLab to apply a
// suggestion there.
function suggestionFits(files, f) {
  const r = f.replace;
  if (!r || r.count < 1) return false;
  const file = files.find((x) => x.newPath === f.file && !x.deleted);
  if (!file) return false;
  for (let l = r.startLine; l < r.startLine + r.count; l++) if (!file.newLines.has(l)) return false;
  return true;
}

// Line comments for the MR diff, like a human reviewer leaves. Only findings
// whose line is in the diff (or within anchor_slack of a changed line) can be
// anchored; the rest stay in the summary note. `fps` lists every finding's
// fingerprint, anchored or not, so n8n can tell which old threads are stale.
// A finding whose fix replaces lines in the diff gets a GitLab suggestion
// (one-click "Apply suggestion") anchored on the first replaced line.
export function planInlineComments({ review, files, job, cfg }) {
  const c = cfg.inline;
  if (!c.enabled) return { comments: [], fps: [], stale: c.stale };
  const refs = { base_sha: job.base_sha, start_sha: job.start_sha || job.base_sha, head_sha: job.head_sha };
  const comments = [];
  const fps = [];
  for (const kind of c.kinds) {
    for (const f of review[KIND_LIST[kind]] ?? []) {
      // Item findings and findings in a related repo can't anchor on this diff.
      if (f.forced || f.repo) continue;
      const useSuggestion = suggestionFits(files, f);
      const line = useSuggestion ? f.replace.startLine : f.file && f.line ? nearestDiffLine(files, f.file, f.line, c.anchor_slack) : null;
      const fp = fingerprint(kind, f, line ?? f.line);
      // One thread per kind per line: a guardrail finding and the model's own
      // finding on the same line share it (the first, the guardrail, wins).
      if (fps.includes(fp)) continue;
      fps.push(fp);
      if (comments.length >= c.max_comments || !line) continue;
      const position = positionFor(files, f.file, line, refs);
      if (!position) continue;
      const suggestion = useSuggestion ? suggestionBlock(f.replace) : '';
      comments.push({ fp, kind, file: f.file, line, position, suggestion: Boolean(suggestion), body: renderInlineBody(kind, f, fp, job.head_sha, cfg, { suggestion }) });
    }
  }
  return { comments, fps, stale: c.stale };
}
