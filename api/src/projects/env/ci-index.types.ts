import type {
  EnvProfileBuildDelivery,
  EnvProfileInjectionPhase,
} from './env-profile.constants';

/** Non-secret manifest written to Vault at `{vaultBasePath}/ci/index` for GitLab CI. */
export interface CiEnvIndex {
  version: 1;
  profiles: CiEnvIndexProfile[];
}

export interface CiEnvIndexProfile {
  id: string;
  injectionPhase: EnvProfileInjectionPhase;
  branches: string[];
  jobSelector?: string;
  buildDelivery?: EnvProfileBuildDelivery;
  workspacePath?: string;
  filename?: string;
  vaultPath: string;
}
