/**
 * GitLab project fields used to detect soft-delete / pending removal.
 */
export interface GitLabProjectDeletionSignals {
  path_with_namespace: string;
  marked_for_deletion_on?: string | null;
  /** @deprecated GitLab still returns this on some versions */
  marked_for_deletion_at?: string | null;
}

/** Renamed pending-delete slug, e.g. `tstsys-deletion_scheduled-1`. */
const DELETION_SCHEDULED_SLUG = /-deletion_scheduled-\d+$/;

export function isGitLabDeletionScheduledPath(pathWithNamespace: string): boolean {
  const slug = pathWithNamespace.split('/').pop() ?? '';
  return DELETION_SCHEDULED_SLUG.test(slug);
}

function hasMarkedForDeletion(
  markedOn?: string | null,
  markedAt?: string | null,
): boolean {
  const value = markedOn ?? markedAt;
  return value != null && value !== '';
}

/**
 * True when GitLab has scheduled the project for deletion — with or without path rename.
 */
export function isGitLabProjectPendingDeletion(project: GitLabProjectDeletionSignals): boolean {
  if (isGitLabDeletionScheduledPath(project.path_with_namespace)) {
    return true;
  }
  return hasMarkedForDeletion(project.marked_for_deletion_on, project.marked_for_deletion_at);
}
