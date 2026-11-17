// Parses a unified git diff into per-file line maps. Used to anchor inline
// MR comments (GitLab needs new_line for added lines, old_line + new_line for
// unchanged context lines) and to find the symbols a change touches.

export function parseDiff(text) {
  const files = [];
  let cur = null;
  let oldLn = 0;
  let newLn = 0;
  for (const line of String(text ?? '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      cur = { oldPath: m ? m[1] : '', newPath: m ? m[2] : '', deleted: false, added: false, hunks: [], newLines: new Map(), oldLines: new Map() };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('--- ')) {
      if (line === '--- /dev/null') cur.added = true;
      else if (line.startsWith('--- a/')) cur.oldPath = line.slice(6);
      continue;
    }
    if (line.startsWith('+++ ')) {
      if (line === '+++ /dev/null') cur.deleted = true;
      else if (line.startsWith('+++ b/')) cur.newPath = line.slice(6);
      continue;
    }
    if (line.startsWith('rename from ')) { cur.oldPath = line.slice(12); continue; }
    if (line.startsWith('rename to ')) { cur.newPath = line.slice(10); continue; }
    const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/);
    if (h) {
      oldLn = Number(h[1]);
      newLn = Number(h[2]);
      cur.hunks.push({ oldStart: oldLn, newStart: newLn, context: h[3] || '', added: [], removed: [] });
      continue;
    }
    const hunk = cur.hunks.at(-1);
    if (!hunk) continue;
    if (line.startsWith('+')) {
      cur.newLines.set(newLn, { type: 'added', text: line.slice(1) });
      hunk.added.push(line.slice(1));
      newLn++;
    } else if (line.startsWith('-')) {
      cur.oldLines.set(oldLn, { type: 'removed' });
      hunk.removed.push(line.slice(1));
      oldLn++;
    } else if (line.startsWith(' ')) {
      cur.newLines.set(newLn, { type: 'context', oldLine: oldLn });
      oldLn++;
      newLn++;
    }
  }
  return files;
}

// GitLab discussion position for a head-side line, or null when the line is
// not part of the MR diff (GitLab rejects positions outside the diff).
export function positionFor(files, path, line, refs) {
  if (!path || !line) return null;
  const f = files.find((x) => x.newPath === path && !x.deleted);
  if (!f) return null;
  const hit = f.newLines.get(line);
  if (!hit) return null;
  const pos = {
    position_type: 'text',
    base_sha: refs.base_sha,
    start_sha: refs.start_sha || refs.base_sha,
    head_sha: refs.head_sha,
    old_path: f.oldPath || f.newPath,
    new_path: f.newPath,
    new_line: line,
  };
  if (hit.type === 'context') pos.old_line = hit.oldLine;
  return pos;
}

// The nearest diff line to `line` in the same file, within `slack` lines, so a
// finding a line or two off still lands on the change.
export function nearestDiffLine(files, path, line, slack = 3) {
  const f = files.find((x) => x.newPath === path && !x.deleted);
  if (!f || !line) return null;
  for (let d = 0; d <= slack; d++) {
    for (const cand of [line - d, line + d]) {
      if (f.newLines.get(cand)?.type === 'added') return cand;
    }
  }
  for (let d = 0; d <= slack; d++) {
    for (const cand of [line - d, line + d]) if (f.newLines.has(cand)) return cand;
  }
  return null;
}
