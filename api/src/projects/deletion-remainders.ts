/** Platform resources that may still exist after a delete attempt. */
export interface DeletionRemainders {
  gitlab: boolean;
  kubernetes: boolean;
  vault: boolean;
  /** SonarQube analysis projects still present for candidate branches. */
  sonar: boolean;
}

export function hasDeletionRemainders(remainders: DeletionRemainders): boolean {
  return remainders.gitlab || remainders.kubernetes || remainders.vault || remainders.sonar;
}

/** Human-readable summary for archived projects and audit metadata. */
export function formatDeletionRemainders(remainders: DeletionRemainders): string[] {
  const parts: string[] = [];
  if (remainders.gitlab) {
    parts.push('GitLab project still exists');
  }
  if (remainders.kubernetes) {
    parts.push('Kubernetes workload resources remain');
  }
  if (remainders.vault) {
    parts.push('Vault secret tree remains');
  }
  if (remainders.sonar) {
    parts.push('SonarQube project(s) still exist');
  }
  return parts;
}
