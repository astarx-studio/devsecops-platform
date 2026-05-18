import { BadRequestException } from '@nestjs/common';

import {
  assertValidBuildPath,
  joinWorkspaceFilePath,
  normalizeWorkspacePath,
} from './env-profile-path.util';

describe('normalizeWorkspacePath', () => {
  it.each(['', '.', './', ' ./ ', '././'])('treats %j as repo root', (input) => {
    expect(normalizeWorkspacePath(input)).toBe('');
  });

  it.each([
    ['path/to/folder', 'path/to/folder'],
    ['./path/to/folder', 'path/to/folder'],
    ['./path/to/folder/', 'path/to/folder'],
    ['path/to/folder/', 'path/to/folder'],
    ['src\\main\\resources', 'src/main/resources'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeWorkspacePath(input)).toBe(expected);
  });

  it('rejects absolute unix paths', () => {
    expect(() => normalizeWorkspacePath('/etc/app')).toThrow(BadRequestException);
  });

  it('rejects parent traversal', () => {
    expect(() => normalizeWorkspacePath('../secret')).toThrow(BadRequestException);
    expect(() => normalizeWorkspacePath('foo/../bar')).toThrow(BadRequestException);
  });
});

describe('assertValidBuildPath', () => {
  it('returns normalized workspace for valid input', () => {
    expect(assertValidBuildPath('./apps/admin', '.env')).toBe('apps/admin');
    expect(assertValidBuildPath('.', '.env')).toBe('');
  });
});

describe('joinWorkspaceFilePath', () => {
  it('places file at repo root when workspace is empty', () => {
    expect(joinWorkspaceFilePath('/builds/proj', '.', '.env')).toBe('/builds/proj/.env');
  });

  it('places file under nested workspace', () => {
    expect(joinWorkspaceFilePath('/builds/proj', './src/main/resources', 'application.properties')).toBe(
      '/builds/proj/src/main/resources/application.properties',
    );
  });
});
