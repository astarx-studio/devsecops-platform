import { buildChartValuesYaml, mergeChartValuesYaml } from './chart-values.util';

describe('chart-values.util', () => {
  it('buildChartValuesYaml includes externalSecret toggle', () => {
    expect(buildChartValuesYaml(true)).toContain('enabled: true');
    expect(buildChartValuesYaml(false)).toContain('enabled: false');
  });

  it('mergeChartValuesYaml preserves probes and service overrides', () => {
    const existing = `externalSecret:
  enabled: true
service:
  targetPort: 8081
probes:
  readiness:
    path: /actuator/health/readiness
`;
    const merged = mergeChartValuesYaml(existing, false);
    expect(merged).toContain('targetPort: 8081');
    expect(merged).toContain('/actuator/health/readiness');
    expect(merged).toContain('enabled: false');
    expect(merged).not.toMatch(/enabled: true/);
  });

  it('mergeChartValuesYaml returns stub when file is missing', () => {
    expect(mergeChartValuesYaml(null, true)).toContain('enabled: true');
  });
});
