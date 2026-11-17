import crypto from 'node:crypto';
import picomatch from 'picomatch';
import { parseGlobList } from './globs.js';

// Related repositories: which GitLab projects a review also looks at, and
// which code of each (the paired open MR, or a branch as the baseline).

const GLOB_CHARS = /[*?[\]{}]/;

// Entries are GitLab paths: a project, a group (all its projects), or a glob
// over project paths. A leading `!` excludes. Returns [{ id, path, default_branch, web_url }].
export async function resolveRelatedProjects({ entries, gitlab, selfPath, max }) {
  const include = entries.filter((e) => !e.startsWith('!'));
  const exclude = entries.filter((e) => e.startsWith('!')).map((e) => e.slice(1));
  const found = new Map();
  const unmatched = [];
  const add = (p) => {
    if (p && p.path_with_namespace && !found.has(p.path_with_namespace)) {
      found.set(p.path_with_namespace, { id: p.id, path: p.path_with_namespace, default_branch: p.default_branch, web_url: p.web_url });
    }
  };
  for (const entry of include) {
    if (GLOB_CHARS.test(entry)) {
      // List the deepest literal group before the glob, then match paths.
      const literal = entry.split('/').filter((s, i, a) => !a.slice(0, i + 1).some((x) => GLOB_CHARS.test(x))).join('/');
      if (!literal) continue;
      const projects = await gitlab.groupProjects(literal);
      const before = found.size;
      for (const p of projects) if (picomatch.isMatch(p.path_with_namespace, entry)) add(p);
      if (found.size === before) unmatched.push(entry);
      continue;
    }
    const project = await gitlab.project(entry);
    if (project) {
      add(project);
      continue;
    }
    const group = await gitlab.group(entry);
    if (group) for (const p of await gitlab.groupProjects(entry)) add(p);
    else unmatched.push(entry);
  }
  const isExcluded = (path) => exclude.some((g) => path === g || picomatch.isMatch(path, g) || path.startsWith(`${g}/`));
  const list = [...found.values()].filter((p) => p.path !== selfPath && !isExcluded(p.path)).slice(0, max);
  // Entries that matched no project or group the bot can read, for the note.
  list.unmatched = unmatched;
  return list;
}

// For each related project, the code to compare against, in order:
// an open MR with the same source branch, an open MR mentioning a linked
// Qestor item, else the fallback branch. Returns [{ path, id, mode, ref, base_sha, head_sha, mr_iid, mr_url, title }].
export async function pairProjects({ projects, job, cfg, gitlab }) {
  const r = cfg.related;
  const itemIds = (job.qestor_items ?? []).map((i) => i.public_id).filter(Boolean).slice(0, 3);
  const out = [];
  for (const p of projects) {
    let mr = null;
    let how = '';
    for (const by of r.pair_by) {
      if (by === 'branch' && job.source_branch) {
        mr = (await gitlab.openMrsBySourceBranch(p.id, job.source_branch))[0] ?? null;
        how = 'same source branch';
      } else if (by === 'qestor_item') {
        for (const id of itemIds) {
          mr = (await gitlab.openMrsMentioning(p.id, id))[0] ?? null;
          how = `mentions \`${id}\``;
          if (mr) break;
        }
      }
      if (mr) break;
    }
    if (mr) {
      const full = await gitlab.mr(p.id, mr.iid);
      const refs = full?.diff_refs;
      if (refs?.head_sha && refs?.base_sha) {
        out.push({ path: p.path, id: p.id, mode: 'mr', how, mr_iid: full.iid, mr_url: full.web_url, title: full.title, source_branch: full.source_branch, target_branch: full.target_branch, base_sha: refs.base_sha, head_sha: refs.head_sha, web_url: p.web_url });
        continue;
      }
    }
    if (r.fallback === 'none') continue;
    const names = r.fallback === 'target_branch' ? [job.target_branch, p.default_branch] : [p.default_branch];
    for (const name of names.filter(Boolean)) {
      const b = await gitlab.branch(p.id, name);
      if (b?.commit?.id) {
        out.push({ path: p.path, id: p.id, mode: 'branch', how: name === job.target_branch ? 'same target branch' : 'default branch', ref: name, head_sha: b.commit.id, web_url: p.web_url });
        break;
      }
    }
  }
  return out;
}

const GENERIC_BRANCHES = new Set(['main', 'master', 'develop', 'development', 'dev', 'prod', 'production', 'staging', 'stg', 'release', 'test', 'hotfix']);

// Finds the other half of a full-stack change without configuration: open
// MRs in other projects with the same source branch that also name one of
// this MR's Qestor items. Both signals must agree, so two unrelated MRs that
// happen to share a branch name don't pair.
export async function discoverPairs({ job, cfg, gitlab }) {
  const r = cfg.related;
  if (r.discover === 'off' || !job.source_branch || GENERIC_BRANCHES.has(job.source_branch.toLowerCase())) return [];
  const itemIds = (job.qestor_items ?? []).map((i) => i.public_id).filter(Boolean);
  if (r.discover === 'same_branch_and_item' && !itemIds.length) return [];
  const mrs = await gitlab.openMrsAnywhereBySourceBranch(job.source_branch);
  const out = [];
  for (const m of mrs) {
    if (Number(m.project_id) === Number(job.project_id)) continue;
    const text = `${m.title ?? ''}\n${m.description ?? ''}`;
    if (r.discover === 'same_branch_and_item' && !itemIds.some((id) => text.includes(id))) continue;
    const project = await gitlab.projectById(m.project_id);
    if (!project?.path_with_namespace || !picomatchAny(project.path_with_namespace, r.allowed)) continue;
    const full = await gitlab.mr(m.project_id, m.iid);
    const refs = full?.diff_refs;
    if (!refs?.head_sha || !refs?.base_sha) continue;
    out.push({
      path: project.path_with_namespace,
      id: project.id,
      mode: 'mr',
      how: r.discover === 'same_branch_and_item' ? 'same source branch and Qestor item, found automatically' : 'same source branch, found automatically',
      discovered: true,
      mr_iid: full.iid,
      mr_url: full.web_url,
      title: full.title,
      source_branch: full.source_branch,
      target_branch: full.target_branch,
      base_sha: refs.base_sha,
      head_sha: refs.head_sha,
      web_url: project.web_url,
    });
  }
  return out;
}

const picomatchAny = (path, globs) => (globs ?? []).some((g) => picomatch.isMatch(path, g));

// Part of the run's dedupe key: a review re-runs when a paired head moves, or
// when the paired MR's own item verdicts change (so a side reviewed first
// picks up what the other side did once that side is reviewed).
export function contextKey(paired, logicVersion = '') {
  if (!paired.length && !logicVersion) return '';
  const s = `${logicVersion}|` + paired
    .map((p) => `${p.path}@${p.head_sha}#${(p.peer_done ?? []).slice().sort().join('+')}`)
    .sort()
    .join(',');
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
}

// How many related projects a job may pull in: X-Review-Related-Max replaces
// related.max_projects, both bounded by related.max_projects_ceiling.
export function relatedMax(cfg, job) {
  const r = cfg.related;
  const fromHeader = Number.isInteger(job.review_related_max) ? job.review_related_max : null;
  return Math.max(0, Math.min(fromHeader ?? r.max_projects, r.max_projects_ceiling));
}

// GitLab paths as people paste them: `/internal/qestor`, `internal/qestor/`,
// or a full URL (https://gitlab.host/internal/qestor/qestor-web, also with
// `/-/merge_requests/…`). All become `internal/qestor[/…]`. `!` is kept.
export function normalizeRelatedEntry(entry) {
  let s = String(entry ?? '').trim();
  const neg = s.startsWith('!');
  if (neg) s = s.slice(1).trim();
  s = s.replace(/^https?:\/\/[^/]+/i, '').replace(/\/-\/.*$/, '').replace(/\.git$/, '');
  s = s.replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
  return s ? `${neg ? '!' : ''}${s}` : '';
}

// The related entries for a job: X-Review-Related header replaces config.
export function relatedEntries(cfg, job) {
  const header = parseGlobList(job.review_related).map(normalizeRelatedEntry).filter(Boolean);
  return header.length ? header : parseGlobList(cfg.related.paths).map(normalizeRelatedEntry).filter(Boolean);
}
