import type { EnvProfile } from '../schemas/project.schema';

import { buildProfilesConflict } from './env-profile-overlap.util';

function buildProfile(
  overrides: Partial<EnvProfile> & Pick<EnvProfile, 'id'>,
): EnvProfile {
  return {
    id: overrides.id,
    label: overrides.label ?? overrides.id,
    injectionPhase: 'build',
    branches: overrides.branches ?? ['development'],
    vaultPath: overrides.vaultPath ?? 'vault/ci/build/x',
    keyNames: overrides.keyNames ?? [],
    updatedAt: overrides.updatedAt ?? new Date(),
    ...overrides,
  };
}

describe('buildProfilesConflict', () => {
  const base = buildProfile({
    id: 'a',
    workspacePath: '',
    filename: '.env',
    jobSelector: undefined,
  });

  it('conflicts when same selector, path, and filename', () => {
    const other = buildProfile({
      id: 'b',
      label: 'other',
      workspacePath: '',
      filename: '.env',
    });
    expect(buildProfilesConflict(base, other)).toBe(true);
  });

  it('allows same branch with different filename', () => {
    const other = buildProfile({ id: 'b', filename: 'application.properties' });
    expect(buildProfilesConflict(base, other)).toBe(false);
  });

  it('allows same branch with different workspace path', () => {
    const other = buildProfile({
      id: 'b',
      workspacePath: 'apps/admin',
      filename: '.env',
    });
    expect(buildProfilesConflict(base, other)).toBe(false);
  });

  it('allows same branch with different job selector', () => {
    const other = buildProfile({ id: 'b', jobSelector: 'admin' });
    expect(buildProfilesConflict(base, other)).toBe(false);
  });

  it('treats equivalent workspace paths as the same destination', () => {
    const a = buildProfile({ id: 'a', workspacePath: './apps/admin', filename: '.env' });
    const b = buildProfile({ id: 'b', workspacePath: 'apps/admin', filename: '.env' });
    expect(buildProfilesConflict(a, b)).toBe(true);
  });

  it('does not compare BUILD with RUNTIME', () => {
    const runtime = buildProfile({
      id: 'b',
      injectionPhase: 'runtime',
      deploymentTargetKeys: ['dev'],
    });
    expect(buildProfilesConflict(base, runtime)).toBe(false);
  });
});
