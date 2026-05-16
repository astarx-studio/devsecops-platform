/** Quality gate enforcement mode per deploy tier when Sonar analysis runs. */
export type SonarGateMode = 'optional' | 'required';

/** Per-environment quality gate policy synced to GitLab as SONAR_GATE_POLICY_JSON. */
export interface SonarGatePolicy {
  dev: SonarGateMode;
  stg: SonarGateMode;
  prod: SonarGateMode;
  other?: SonarGateMode;
}

/** Sonar opt-in configuration stored on Project documents. */
export interface ProjectSonarConfig {
  allowedBranches: string[];
  gatePolicy?: SonarGatePolicy;
}

export const DEFAULT_SONAR_GATE_POLICY: SonarGatePolicy = {
  dev: 'optional',
  stg: 'required',
  prod: 'required',
  other: 'optional',
};

/**
 * Merges partial gate policy with platform defaults.
 *
 * @param partial - User-supplied overrides
 * @returns Effective policy for CI and API responses
 */
export function resolveSonarGatePolicy(partial?: Partial<SonarGatePolicy>): SonarGatePolicy {
  return {
    dev: partial?.dev ?? DEFAULT_SONAR_GATE_POLICY.dev,
    stg: partial?.stg ?? DEFAULT_SONAR_GATE_POLICY.stg,
    prod: partial?.prod ?? DEFAULT_SONAR_GATE_POLICY.prod,
    other: partial?.other ?? DEFAULT_SONAR_GATE_POLICY.other,
  };
}

/**
 * Returns true when Sonar scanning is enabled (non-empty branch allowlist).
 */
export function isSonarEnabled(sonar?: ProjectSonarConfig | null): boolean {
  return Boolean(sonar?.allowedBranches?.length);
}
