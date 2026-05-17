/** Result of scanning GitLab for projects missing from the platform registry. */
export interface ReconcileGitLabProjectsResult {
  /** New MongoDB rows created as legacyV1 backfills. */
  backfilled: number;
  /** Active registry rows archived because GitLab marked the project for deletion. */
  archivedFromRegistry: number;
  /** GitLab paths of newly backfilled projects (for operator feedback). */
  backfilledGitlabPaths: string[];
  /** Human-readable summary. */
  message: string;
}
