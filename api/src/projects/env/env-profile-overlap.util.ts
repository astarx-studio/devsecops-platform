import type { EnvProfile } from '../schemas/project.schema';

import { normalizeWorkspacePath } from './env-profile-path.util';

/** Normalized job selector for overlap checks (empty = any Kaniko job). */
export function normalizeJobSelector(jobSelector?: string): string {
  return (jobSelector ?? '').trim();
}

/** Normalized BUILD profile destination (workspace + filename). */
export function normalizeBuildDestination(
  workspacePath?: string,
  filename?: string,
): { workspacePath: string; filename: string } {
  return {
    workspacePath: normalizeWorkspacePath(workspacePath ?? '.'),
    filename: (filename ?? '').trim(),
  };
}

/**
 * True when two BUILD profiles target the same CI file on overlapping branches
 * (same job selector, workspace path, and filename).
 */
export function buildProfilesConflict(a: EnvProfile, b: EnvProfile): boolean {
  if (a.injectionPhase !== 'build' || b.injectionPhase !== 'build') {
    return false;
  }

  if (normalizeJobSelector(a.jobSelector) !== normalizeJobSelector(b.jobSelector)) {
    return false;
  }

  const destA = normalizeBuildDestination(a.workspacePath, a.filename);
  const destB = normalizeBuildDestination(b.workspacePath, b.filename);

  return destA.workspacePath === destB.workspacePath && destA.filename === destB.filename;
}

/** Human-readable BUILD destination for API error messages. */
export function formatBuildProfileDestination(profile: EnvProfile): string {
  const { workspacePath, filename } = normalizeBuildDestination(
    profile.workspacePath,
    profile.filename,
  );
  const selector = normalizeJobSelector(profile.jobSelector);
  const selectorLabel = selector ? `job "${selector}"` : 'any job';
  const pathLabel = workspacePath ? `${workspacePath}/${filename}` : `(repo root)/${filename}`;
  return `${selectorLabel}, ${pathLabel}`;
}
