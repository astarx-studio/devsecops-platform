import {
  formatDeletionRemainders,
  hasDeletionRemainders,
} from './deletion-remainders';

describe('deletion-remainders', () => {
  it('hasDeletionRemainders is true when any component remains', () => {
    expect(hasDeletionRemainders({ gitlab: false, kubernetes: false, vault: false })).toBe(
      false,
    );
    expect(hasDeletionRemainders({ gitlab: true, kubernetes: false, vault: false })).toBe(
      true,
    );
  });

  it('formatDeletionRemainders lists remaining components', () => {
    expect(
      formatDeletionRemainders({ gitlab: true, kubernetes: false, vault: true }),
    ).toEqual(['GitLab project still exists', 'Vault secret tree remains']);
  });
});
