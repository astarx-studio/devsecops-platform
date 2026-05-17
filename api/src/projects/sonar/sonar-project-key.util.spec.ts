import {
  buildSonarProjectKey,
  buildSonarProjectName,
  normalizeSonarProjectKey,
} from './sonar-project-key.util';

describe('normalizeSonarProjectKey', () => {
  it('strips trailing underscore from echo+tr newline artifact', () => {
    expect(normalizeSonarProjectKey('external-kai-datahub-datahub-fe_main\n')).toBe(
      'external-kai-datahub-datahub-fe_main',
    );
  });

  it('collapses repeated underscores', () => {
    expect(normalizeSonarProjectKey('a__b___c')).toBe('a_b_c');
  });
});

describe('buildSonarProjectKey', () => {
  it('matches Auto DevOps pipeline slug rules', () => {
    expect(buildSonarProjectKey('external/kai/datahub/datahub-fe', 'main')).toBe(
      'external-kai-datahub-datahub-fe_main',
    );
  });

  it('normalizes special characters in branch names', () => {
    expect(buildSonarProjectKey('group/repo', 'release/1.0')).toBe('group-repo_release-1-0');
  });
});

describe('buildSonarProjectName', () => {
  it('formats display name with branch', () => {
    expect(buildSonarProjectName('Datahub FE', 'staging')).toBe('Datahub FE (staging)');
  });
});
