import { changedSymbols } from './related.js';
import { matchesAny } from './globs.js';

// Builds the "Related repositories" prompt section: for each paired repo, the
// paired MR's diff (or the baseline branch it's checked against) and the
// places in that repo that use what this MR touches: API paths, GraphQL
// operations, identifiers and column names.

// A path inside a string literal; it ends at a query, a template expression,
// or the closing quote.
const API_PATH = /['"`](\/(?:api|internal|webhooks?)\/[A-Za-z0-9_\-/.:]+)/g;

function apiPathsIn(lines) {
  const out = new Set();
  for (const line of lines) {
    API_PATH.lastIndex = 0;
    let m;
    while ((m = API_PATH.exec(line))) {
      const p = m[1].replace(/\/+$/, '');
      if (p.split('/').length >= 3) out.add(p);
    }
  }
  return [...out];
}

// API paths this MR adds (calls or routes), for the contract check.
export function addedApiPaths(files) {
  return apiPathsIn(files.flatMap((f) => f.hunks.flatMap((h) => h.added)));
}

// For each path, is it defined or used in the related repo? If not, the
// nearest paths under the same parent, so the model sees the mismatch as a fact.
async function contractCheck(repo, headSha, paths, cfg) {
  const lines = [];
  for (const p of paths.slice(0, 8)) {
    const exact = await repo.grep(headSha, p, '', 5, { fixed: true }).catch(() => ({ hits: [] }));
    const hits = exact.hits.filter((h) => !matchesAny(h.split(':')[0], cfg.standard.ignore_paths));
    if (hits.length) {
      lines.push(`- \`${p}\`: found (${hits.slice(0, 2).map((h) => `\`${h.split(':').slice(0, 2).join(':')}\``).join(', ')})`);
      continue;
    }
    const parent = p.replace(/\/[^/]*$/, '/');
    const near = await repo.grep(headSha, parent, '', 20, { fixed: true }).catch(() => ({ hits: [] }));
    const nearPaths = new Map();
    for (const h of near.hits) {
      const [file, ln, ...rest] = h.split(':');
      for (const q of apiPathsIn([rest.join(':')])) if (q !== p && q.startsWith(parent)) nearPaths.set(q, `${file}:${ln}`);
    }
    lines.push(
      nearPaths.size
        ? `- \`${p}\`: **NOT FOUND**. This repository has ${[...nearPaths].slice(0, 4).map(([q, at]) => `\`${q}\` (\`${at}\`)`).join(', ')} under \`${parent}\`. Likely an endpoint mismatch.`
        : `- \`${p}\`: not found in this repository.`,
    );
  }
  return lines;
}
const GQL_OP = /\b(?:query|mutation|subscription)\s+([A-Za-z_]\w*)/g;
const SNAKE = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+){1,})\b/g;

export function crossTerms(files, max) {
  const terms = new Map();
  const add = (t, w) => {
    if (t && t.length >= 4) terms.set(t, (terms.get(t) ?? 0) + w);
  };
  for (const f of files) {
    for (const h of f.hunks) {
      for (const line of [...h.added, ...h.removed]) {
        for (const re of [API_PATH, GQL_OP]) {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(line))) add(m[1].replace(/\$\{[^}]*\}|:\w+/g, ''), 5);
        }
        SNAKE.lastIndex = 0;
        let m;
        while ((m = SNAKE.exec(line))) if (m[1].length >= 6) add(m[1], 1);
      }
    }
  }
  for (const s of changedSymbols(files, max)) add(s, 3);
  return [...terms.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([t]) => t.replace(/\/+$/, ''));
}

const fence = (kind, body) => `<untrusted ${kind}>\n${String(body).replace(/<\/untrusted/gi, '</untrusted_')}\n</untrusted>`;

// `paired` comes from pairProjects; `repoFor(p)` returns a fetched Repo.
export async function gatherCrossRepo({ paired, files, cfg, repoFor, log = console }) {
  const r = cfg.related;
  const terms = crossTerms(files, r.max_terms);
  const apiPaths = addedApiPaths(files);
  const sections = [];
  const repos = [];
  // Raw paired diffs (no fences) for the guardrail scans.
  const pairedDiffs = [];
  for (const p of paired) {
    let repo;
    try {
      repo = await repoFor(p);
    } catch (err) {
      log.error(`related: fetch ${p.path} failed: ${err.message}`);
      sections.push(`### \`${p.path}\`\nCould not fetch this repository: ${err.message}`);
      continue;
    }
    repos.push({ ...p, repo });
    const head = p.mode === 'mr'
      ? `### \`${p.path}\` — paired MR !${p.mr_iid} (${p.how}) at \`${p.head_sha.slice(0, 12)}\`: ${p.title}`
      : `### \`${p.path}\` — no paired MR; checked against \`${p.ref}\` (${p.how}) at \`${p.head_sha.slice(0, 12)}\``;
    const parts = [head];
    if (apiPaths.length) {
      const check = await contractCheck(repo, p.head_sha, apiPaths, cfg);
      parts.push(`Contract check (API paths this MR adds, looked up in this repository at its paired head):\n${check.join('\n')}`);
    }
    if (p.mode === 'mr') {
      let diff = await repo.diff(p.base_sha, p.head_sha, cfg.standard.ignore_paths).catch((e) => `(diff failed: ${e.message})`);
      if (Buffer.byteLength(diff) > r.max_paired_diff_bytes) diff = `${diff.slice(0, r.max_paired_diff_bytes)}\n[paired diff truncated]`;
      pairedDiffs.push({ path: p.path, mr_iid: p.mr_iid, diff });
      parts.push(`Paired MR diff:\n${fence('paired-diff', diff || '(empty)')}`);
    }
    const hits = [];
    for (const t of terms) {
      const g = await repo.grep(p.head_sha, t, '', r.max_hits_per_term, { fixed: true, word: /^\w+$/.test(t) }).catch(() => ({ hits: [] }));
      const kept = g.hits.filter((h) => !matchesAny(h.split(':')[0], cfg.standard.ignore_paths)).slice(0, r.max_hits_per_term);
      if (kept.length) hits.push(`\`${t}\`:\n${kept.join('\n')}`);
    }
    parts.push(hits.length ? `Uses in this repository of what the reviewed MR touches:\n${fence('cross-hits', hits.join('\n\n'))}` : 'No uses found in this repository of what the reviewed MR touches.');
    sections.push(parts.join('\n\n'));
  }
  return { text: sections.join('\n\n'), repos, terms, pairedDiffs };
}
