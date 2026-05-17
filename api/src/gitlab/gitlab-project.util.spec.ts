import {
  isGitLabDeletionScheduledPath,
  isGitLabProjectPendingDeletion,
} from './gitlab-project.util';

describe('isGitLabDeletionScheduledPath', () => {
  it('returns true for GitLab scheduled-deletion slug suffix', () => {
    expect(isGitLabDeletionScheduledPath('system/tstsys-deletion_scheduled-1')).toBe(true);
  });

  it('returns false for normal project paths', () => {
    expect(isGitLabDeletionScheduledPath('demo/demo-api')).toBe(false);
  });
});

describe('isGitLabProjectPendingDeletion', () => {
  it('detects renamed pending-delete paths', () => {
    expect(
      isGitLabProjectPendingDeletion({
        path_with_namespace: 'external/kai/datahub-fe-deletion_scheduled-2',
      }),
    ).toBe(true);
  });

  it('detects marked_for_deletion_on without path rename', () => {
    expect(
      isGitLabProjectPendingDeletion({
        path_with_namespace: 'demo/demo-api',
        marked_for_deletion_on: '2026-05-17',
      }),
    ).toBe(true);
  });

  it('detects deprecated marked_for_deletion_at', () => {
    expect(
      isGitLabProjectPendingDeletion({
        path_with_namespace: 'demo/demo-web',
        marked_for_deletion_at: '2026-05-17',
      }),
    ).toBe(true);
  });

  it('returns false for active projects', () => {
    expect(
      isGitLabProjectPendingDeletion({
        path_with_namespace: 'clients/acme/webapp',
      }),
    ).toBe(false);
  });
});
