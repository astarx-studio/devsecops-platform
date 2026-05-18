import { BadRequestException } from '@nestjs/common';

import type { EnvProfileBuildDelivery } from './env-profile.constants';

/**
 * Validates BUILD profile filename (single segment, no traversal).
 */
export function assertValidFilename(filename: string): void {
  if (!filename || filename.includes('/') || filename.includes('\\')) {
    throw new BadRequestException('filename must be a single path segment (no slashes)');
  }

  if (filename === '.' || filename === '..') {
    throw new BadRequestException('filename must not be . or ..');
  }
}

/**
 * Normalizes workspacePath to a repo-relative directory without `.` / `..` segments.
 *
 * Accepted root forms: `""`, `"."`, `"./"`.
 * Accepted nested forms: `path/to/dir`, `./path/to/dir`, optional trailing `/`.
 *
 * Absolute paths (`/etc/...`, `C:\...`) are rejected. A leading `/` is reserved for a
 * possible future host-level config feature; only paths relative to the repo root are supported.
 */
export function normalizeWorkspacePath(workspacePath: string): string {
  let p = workspacePath.trim().replace(/\\/g, '/');

  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) {
    throw new BadRequestException(
      'workspacePath must be relative to the repository root (do not use a leading /)',
    );
  }

  while (p.startsWith('./')) {
    p = p.slice(2);
  }

  p = p.replace(/\/+$/, '');

  if (p === '' || p === '.') {
    return '';
  }

  const segments = p.split('/').filter((seg) => seg.length > 0);
  for (const seg of segments) {
    if (seg === '.' || seg === '..') {
      throw new BadRequestException('workspacePath must not contain . or .. path segments');
    }
  }

  return segments.join('/');
}

/**
 * Validates filename and returns normalized workspacePath for Vault / CI.
 */
export function assertValidBuildPath(workspacePath: string, filename: string): string {
  assertValidFilename(filename);
  return normalizeWorkspacePath(workspacePath);
}

/**
 * Joins repo root (CI_PROJECT_DIR) with normalized workspacePath and filename.
 */
export function joinWorkspaceFilePath(
  projectDir: string,
  workspacePath: string,
  filename: string,
): string {
  const dir = projectDir.replace(/\/+$/, '');
  const normalized = normalizeWorkspacePath(workspacePath);
  if (!normalized) {
    return `${dir}/${filename}`;
  }
  return `${dir}/${normalized}/${filename}`;
}

/**
 * Vault path for a BUILD profile's stored secrets.
 */
export function buildProfileVaultPath(vaultBasePath: string, profileId: string): string {
  return `${vaultBasePath}/ci/build/${profileId}`;
}

/**
 * Vault path for runtime secrets of a deployment target.
 */
export function buildRuntimeTargetVaultPath(
  vaultBasePath: string,
  targetKey: string,
): string {
  return `${vaultBasePath}/${targetKey}`;
}

/**
 * Suggests default build delivery from filename (UI hint only; caller may override).
 */
export function suggestBuildDelivery(filename: string): EnvProfileBuildDelivery {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.env') || lower === '.env') {
    return 'dotenv_build_args';
  }
  return 'raw_file';
}
