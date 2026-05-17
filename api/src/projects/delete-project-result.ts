import type { ProjectDocument } from './schemas/project.schema';

/** Result of deleteProject — full removal or archived when GitLab blocks deletion. */
export type DeleteProjectOutcome = 'deleted' | 'archived';

export interface DeleteProjectResult {
  outcome: DeleteProjectOutcome;
  message?: string;
  project?: ProjectDocument;
}

export interface DeleteProjectOptions {
  /** Purge container registry and packages before GitLab project delete. */
  forceGitLabDelete?: boolean;
  /** Skip K8s/Vault/Sonar teardown (e.g. retry GitLab delete on an archived project). */
  skipPlatformCleanup?: boolean;
}
