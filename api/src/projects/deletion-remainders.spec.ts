import {
  formatDeletionRemainders,
  hasDeletionRemainders,
} from './deletion-remainders';

describe('deletion-remainders', () => {
  it('hasDeletionRemainders is true when any component remains', () => {
    expect(
      hasDeletionRemainders({ gitlab: false, kubernetes: false, vault: false, sonar: false }),
    ).toBe(false);
    expect(
      hasDeletionRemainders({ gitlab: true, kubernetes: false, vault: false, sonar: false }),
    ).toBe(true);
    expect(
      hasDeletionRemainders({ gitlab: false, kubernetes: false, vault: false, sonar: true }),
    ).toBe(true);
  });

  it('formatDeletionRemainders lists remaining components', () => {
    expect(
      formatDeletionRemainders({ gitlab: true, kubernetes: false, vault: true, sonar: true }),
    ).toEqual([
      'GitLab project still exists',
      'Vault secret tree remains',
      'SonarQube project(s) still exist',
    ]);
  });
});
