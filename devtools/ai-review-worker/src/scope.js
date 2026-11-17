import { matchesAny, parseGlobList, targetBranchAllowed } from './globs.js';
import { projectEnabled } from './config.js';

// Decides whether a job should be reviewed. Returns { review: true } or
// { review: false, reason } with a reason that is written on the run row.
export function decideScope(file, cfg, job) {
  if (!projectEnabled(file, job.project_path)) {
    return { review: false, reason: `project ${job.project_path} not in enabled_projects` };
  }
  const s = cfg.scope;
  const target = targetBranchAllowed(job.target_branch, job.review_only, s.target_branches);
  if (!target.allowed) {
    return { review: false, reason: `target ${job.target_branch} not in ${target.source} (${target.globs.join(', ')})` };
  }
  const include = parseGlobList(s.source_branch_include);
  if (include.length && !matchesAny(job.source_branch, include)) {
    return { review: false, reason: `source ${job.source_branch} not in source_branch_include` };
  }
  if (matchesAny(job.source_branch, parseGlobList(s.source_branch_exclude))) {
    return { review: false, reason: `source ${job.source_branch} in source_branch_exclude` };
  }
  if (s.skip_draft && job.draft) return { review: false, reason: 'merge request is a draft' };
  const labels = (job.labels ?? []).map(String);
  const hit = labels.find((l) => s.skip_labels.includes(l));
  if (hit) return { review: false, reason: `label ${hit} is in skip_labels` };
  if (s.require_qestor_items && !(job.qestor_items ?? []).length) {
    return { review: false, reason: 'no linked Qestor items and require_qestor_items is on' };
  }
  return { review: true };
}
