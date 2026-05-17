/**
 * Normalizes a Sonar project key segment the same way as the Auto DevOps `sonar:scan` job.
 * Strips stray whitespace/newlines and collapses underscores (CI used to append `_` via `echo` + `tr`).
 */
export function normalizeSonarProjectKey(combined: string): string {
  return combined
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Approximates GitLab `CI_PROJECT_PATH_SLUG` from `path_with_namespace`.
 */
export function slugifyGitlabProjectPath(pathWithNamespace: string): string {
  return pathWithNamespace
    .trim()
    .toLowerCase()
    .replace(/\//g, '-')
    .replace(/[^a-z0-9.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Approximates GitLab `CI_COMMIT_REF_SLUG` from a branch or tag name.
 */
export function slugifyGitRef(ref: string): string {
  return ref
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Builds a Sonar project key matching the Auto DevOps `sonar:scan` job.
 *
 * CI uses: `printf '%s' "${CI_PROJECT_PATH_SLUG}_${CI_COMMIT_REF_SLUG}"` then lowercases and
 * maps disallowed characters to `_`, then trims leading/trailing `_`.
 *
 * @param gitlabPath - Full GitLab path (e.g. external/kai/datahub/datahub-fe)
 * @param branch - Git branch name (e.g. main, staging)
 * @returns Sonar `project` key safe for the Web API and scanner
 */
export function buildSonarProjectKey(gitlabPath: string, branch: string): string {
  const pathSlug = slugifyGitlabProjectPath(gitlabPath);
  const refSlug = slugifyGitRef(branch);
  return normalizeSonarProjectKey(`${pathSlug}_${refSlug}`);
}

/**
 * Human-readable Sonar project name aligned with CI (`CI_PROJECT_NAME (branch)`).
 *
 * @param projectLabel - Display name or repo slug
 * @param branch - Git branch name
 */
export function buildSonarProjectName(projectLabel: string, branch: string): string {
  return `${projectLabel} (${branch.trim()})`;
}
