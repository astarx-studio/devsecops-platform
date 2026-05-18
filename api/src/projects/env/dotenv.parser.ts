import { BadRequestException } from '@nestjs/common';

/**
 * Parses dotenv-style text into key/value pairs.
 * Supports `#` comments and `KEY=value` lines (no multiline values in v1).
 *
 * @param content - Raw file body
 * @returns Parsed key/value map (keys are not filtered by prefix)
 */
export function parseDotenvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      throw new BadRequestException(
        `Invalid dotenv line (expected KEY=value): ${trimmed.slice(0, 80)}`,
      );
    }

    const key = trimmed.slice(0, eq).trim();
    if (!key) {
      throw new BadRequestException('Invalid dotenv line: empty key');
    }

    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}
