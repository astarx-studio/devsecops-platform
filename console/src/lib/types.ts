export type Provisioning = 'AUTO_DEVOPS' | 'TEMPLATE';
export type ClusterProfile = 'dev' | 'stg' | 'prod';
export type Env = 'dev' | 'stg' | 'prod';
export type SonarGateMode = 'optional' | 'required';

export interface DeploymentTarget {
  key: string;
  kubeNamespace: string;
  clusterProfile: ClusterProfile;
  appHost: string;
  deployRef: string;
  enabled: boolean;
  gitlabEnvironment?: string | null;
}

export interface Capabilities {
  deployable: boolean;
  publishable: boolean;
}

export interface AppHosts {
  dev?: string | null;
  stg?: string | null;
  prod?: string | null;
}

export interface SonarGatePolicy {
  dev: SonarGateMode;
  stg: SonarGateMode;
  prod: SonarGateMode;
  other?: SonarGateMode | null;
}

export type EnvProfileInjectionPhase = 'BUILD' | 'RUNTIME';
export type EnvProfileBuildDelivery = 'RAW_FILE' | 'DOTENV_BUILD_ARGS';

export interface EnvProfile {
  id: string;
  label: string;
  injectionPhase: EnvProfileInjectionPhase;
  branches: string[];
  deploymentTargetKeys?: string[] | null;
  jobSelector?: string | null;
  workspacePath?: string | null;
  filename?: string | null;
  buildDelivery?: EnvProfileBuildDelivery | null;
  vaultPath: string;
  contentType?: string | null;
  keyNames: string[];
  updatedAt?: string | null;
}

export interface ProjectSonar {
  allowedBranches: string[];
  gatePolicy: SonarGatePolicy;
  dashboardUrl?: string | null;
}

export interface SonarBranchProvision {
  branch: string;
  projectKey: string;
  projectName: string;
  created: boolean;
  dashboardUrl: string;
}

export type DeleteProjectOutcome = 'DELETED' | 'ARCHIVED';

export interface DeleteProjectResult {
  outcome: DeleteProjectOutcome;
  message?: string | null;
  project?: Project | null;
}

export interface ReconcileGitLabProjectsResult {
  backfilled: number;
  archivedFromRegistry: number;
  backfilledGitlabPaths: string[];
  message: string;
}

export interface Project {
  id: string;
  gitlabProjectId: number;
  gitlabPath: string;
  groupPath: string[];
  projectSlug: string;
  effectiveSlug: string;
  displayName?: string | null;
  provisioning: Provisioning;
  templateSlug?: string | null;
  vaultBasePath: string;
  helmReleaseName: string;
  appHosts: AppHosts;
  deploymentTargets: DeploymentTarget[];
  capabilities: Capabilities;
  envProfiles?: EnvProfile[];
  runtimeEnvEnabled: boolean;
  sonar?: ProjectSonar | null;
  legacyV1: boolean;
  pinnedV1: boolean;
  archived: boolean;
  archivedAt?: string | null;
  archiveReason?: string | null;
  gitlabDeleteError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GraphqlError {
  message: string;
}

export interface GraphqlResponse<T> {
  data?: T;
  errors?: GraphqlError[];
}

export interface HealthStatus {
  status: string;
  mongo?: string;
  vault?: string;
}
