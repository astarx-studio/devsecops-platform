import yaml from 'js-yaml';

export const CHART_VALUES_HEADER = `# Chart value overrides for the dsoaas-app Helm chart.
# Committed by the platform API during project provisioning.
# Project metadata (path, env, host) is injected by the pipeline at deploy time
# via --set flags; do not duplicate it here.
# Use this file for app-specific overrides: probes, resources, replicaCount, extraEnv.
`;

/**
 * Minimal chart-values.yaml for new Auto DevOps projects (per-app overrides added by teams).
 */
export function buildChartValuesYaml(runtimeEnvEnabled = true): string {
  return `${CHART_VALUES_HEADER}externalSecret:
  enabled: ${runtimeEnvEnabled ? 'true' : 'false'}
`;
}

/**
 * Updates only externalSecret.enabled while preserving probes, resources, service ports, etc.
 * Full replace with the stub was wiping app-specific Helm overrides on every env profile change.
 */
export function mergeChartValuesYaml(
  existingContent: string | null | undefined,
  runtimeEnvEnabled: boolean,
): string {
  if (!existingContent?.trim()) {
    return buildChartValuesYaml(runtimeEnvEnabled);
  }

  let doc: Record<string, unknown>;
  try {
    const parsed = yaml.load(existingContent);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return buildChartValuesYaml(runtimeEnvEnabled);
    }
    doc = { ...(parsed as Record<string, unknown>) };
  } catch {
    return existingContent;
  }

  const prev = doc.externalSecret;
  const externalSecret =
    prev && typeof prev === 'object' && !Array.isArray(prev)
      ? { ...(prev as Record<string, unknown>) }
      : {};
  externalSecret.enabled = runtimeEnvEnabled;
  doc.externalSecret = externalSecret;

  const body = yaml.dump(doc, { lineWidth: -1, noRefs: true }).trimEnd();
  return `${CHART_VALUES_HEADER}${body}\n`;
}
