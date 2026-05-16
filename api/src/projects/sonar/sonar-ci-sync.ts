import type { SonarGatePolicy, ProjectSonarConfig } from './sonar.types';
import { isSonarEnabled, resolveSonarGatePolicy } from './sonar.types';

/** GitLab CI variable keys used by the auto-devops Sonar job. */
export const SONAR_CI_KEYS = {
  ALLOWED_BRANCHES: 'SONAR_ALLOWED_BRANCHES',
  TOKEN: 'SONAR_TOKEN',
  GATE_POLICY_JSON: 'SONAR_GATE_POLICY_JSON',
  HOST_URL: 'SONAR_HOST_URL',
  HOST_URL_INTERNAL: 'SONAR_HOST_URL_INTERNAL',
} as const;

/**
 * Builds GitLab CI variable payloads for Sonar configuration.
 *
 * @param sonar - Effective Sonar config (disabled when allowlist empty)
 * @param options - Public/internal Sonar URLs and optional analysis token
 * @returns Variables to pass to GitLabService.setProjectCiVariables
 */
export function buildSonarCiVariables(
  sonar: ProjectSonarConfig | undefined,
  options: {
    publicUrl: string;
    internalUrl: string;
    token?: string;
  },
): Array<{ key: string; value: string; environmentScope: string; masked?: boolean }> {
  if (!isSonarEnabled(sonar)) {
    return [
      { key: SONAR_CI_KEYS.ALLOWED_BRANCHES, value: '', environmentScope: '*', masked: false },
      { key: SONAR_CI_KEYS.GATE_POLICY_JSON, value: '', environmentScope: '*', masked: false },
    ];
  }

  const gatePolicy: SonarGatePolicy = resolveSonarGatePolicy(sonar?.gatePolicy);
  const vars: Array<{
    key: string;
    value: string;
    environmentScope: string;
    masked?: boolean;
  }> = [
    {
      key: SONAR_CI_KEYS.ALLOWED_BRANCHES,
      value: sonar!.allowedBranches.join(','),
      environmentScope: '*',
      masked: false,
    },
    {
      key: SONAR_CI_KEYS.GATE_POLICY_JSON,
      value: JSON.stringify(gatePolicy),
      environmentScope: '*',
      masked: false,
    },
    {
      key: SONAR_CI_KEYS.HOST_URL,
      value: options.publicUrl,
      environmentScope: '*',
      masked: false,
    },
    {
      key: SONAR_CI_KEYS.HOST_URL_INTERNAL,
      value: options.internalUrl,
      environmentScope: '*',
      masked: false,
    },
  ];

  if (options.token) {
    vars.push({
      key: SONAR_CI_KEYS.TOKEN,
      value: options.token,
      environmentScope: '*',
      masked: true,
    });
  }

  return vars;
}
