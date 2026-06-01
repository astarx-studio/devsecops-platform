import { dump, load } from 'js-yaml';

export const MERGE_HEADER = '# Managed by DSOaaS — Auto DevOps pipeline include';

/**
 * Removes repeated DSOaaS merge header lines left by earlier fallback merges.
 */
export function stripDsoaasManagedPreamble(content: string): string {
  const lines = content.split('\n').filter((line) => line.trim() !== MERGE_HEADER);
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

export interface MergeProjectGitlabCiResult {
  content: string;

  preservedUserKeys: string[];

  parseWarning?: string;

  /** When true, caller must not overwrite the existing root `.gitlab-ci.yml`. */

  skipRootWrite: boolean;

  /** Line-based include replacement was used because full-file parse failed. */

  usedIncludeFallback?: boolean;
}

/** Top-level key line in GitLab CI YAML (not indented). */

const TOP_LEVEL_KEY = /^[a-zA-Z_][\w-]*:\s*$/;

function isIncludeBlockLine(line: string, inInclude: boolean): boolean {
  if (!inInclude) {
    return TOP_LEVEL_KEY.test(line) && line.startsWith('include:');
  }

  if (line.trim() === '') {
    return true;
  }

  if (/^\s/.test(line)) {
    return true;
  }

  return false;
}

/**

 * Replaces only the top-level `include:` block when full YAML parse fails (e.g. `!reference` tags).

 *

 * @returns Merged file content, or null when no safe merge is possible.

 */

export function mergeIncludeBlockFallback(
  existingContent: string,

  managedIncludes: Array<Record<string, unknown>>,
): string | null {
  const trimmed = stripDsoaasManagedPreamble(existingContent.trimEnd());

  if (!trimmed) {
    return null;
  }

  /** Require at least one top-level `key:` line so we do not prepend includes into garbage files. */
  if (!/^[^\s#][\w-]*:/m.test(trimmed)) {
    return null;
  }

  const includeBody = dump(
    { include: managedIncludes },
    { lineWidth: 120, noRefs: true },
  ).trimEnd();

  const lines = trimmed.split('\n');

  let includeStart = -1;

  let includeEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (includeStart < 0) {
      if (line === 'include:' || line.startsWith('include:')) {
        includeStart = i;

        includeEnd = i;
      }

      continue;
    }

    if (isIncludeBlockLine(line, true)) {
      includeEnd = i;

      continue;
    }

    break;
  }

  if (includeStart < 0) {
    return `${MERGE_HEADER}\n${includeBody}\n\n${trimmed}\n`;
  }

  const before = lines.slice(0, includeStart);

  const after = lines.slice(includeEnd + 1);

  const parts: string[] = [];

  if (before.some((l) => l.trim().length > 0)) {
    parts.push(before.join('\n').trimEnd());
  }

  parts.push(`${MERGE_HEADER}\n${includeBody}`);

  if (after.some((l) => l.trim().length > 0)) {
    parts.push(after.join('\n').trimEnd());
  }

  return `${parts.join('\n\n')}\n`;
}

/**

 * Merges DSOaaS-managed `include` into an existing root `.gitlab-ci.yml` while preserving

 * user-defined top-level keys (e.g. `test:` overrides).

 */

export function mergeProjectGitlabCi(
  existingContent: string | null,

  managedIncludes: Array<Record<string, unknown>>,
): MergeProjectGitlabCiResult {
  const preservedUserKeys: string[] = [];
  const normalizedExisting = existingContent
    ? stripDsoaasManagedPreamble(existingContent)
    : existingContent;

  if (!normalizedExisting?.trim()) {
    const merged: Record<string, unknown> = { include: managedIncludes };

    const body = dump(merged, { lineWidth: 120, noRefs: true }).trimEnd();

    return {
      content: `${MERGE_HEADER}\n${body}\n`,

      preservedUserKeys,

      skipRootWrite: false,
    };
  }

  let doc: Record<string, unknown> = {};

  let parseWarning: string | undefined;

  try {
    const parsed = load(normalizedExisting);

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      doc = parsed as Record<string, unknown>;
    }
  } catch (err) {
    parseWarning = `Could not parse existing .gitlab-ci.yml: ${(err as Error).message}`;
  }

  if (!parseWarning) {
    for (const key of Object.keys(doc)) {
      if (key !== 'include') {
        preservedUserKeys.push(key);
      }
    }

    const merged: Record<string, unknown> = { include: managedIncludes };

    for (const key of preservedUserKeys) {
      merged[key] = doc[key];
    }

    const body = dump(merged, { lineWidth: 120, noRefs: true }).trimEnd();

    return {
      content: `${MERGE_HEADER}\n${body}\n`,

      preservedUserKeys,

      skipRootWrite: false,
    };
  }

  const fallbackContent = mergeIncludeBlockFallback(normalizedExisting, managedIncludes);

  if (fallbackContent) {
    return {
      content: fallbackContent,

      preservedUserKeys: [],

      parseWarning,

      skipRootWrite: false,

      usedIncludeFallback: true,
    };
  }

  return {
    content: normalizedExisting ?? existingContent ?? '',

    preservedUserKeys: [],

    parseWarning,

    skipRootWrite: true,
  };
}
