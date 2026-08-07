/**
 * Client-side dotenv helpers for env profile create/edit UIs.
 * Mirrors api dotenv v1 rules: KEY=value lines, # comments, no multiline values.
 */

export interface EnvKeyValueRow {
  id: string;
  key: string;
  value: string;
}

let rowSeq = 0;

/** Creates a stable local row id for React keys (not persisted). */
export function createEnvRowId(): string {
  rowSeq += 1;
  return `env-row-${rowSeq}`;
}

export function emptyEnvRows(count = 1): EnvKeyValueRow[] {
  return Array.from({ length: count }, () => ({
    id: createEnvRowId(),
    key: "",
    value: "",
  }));
}

export function entriesToRows(
  entries: Array<{ key: string; value: string }>,
): EnvKeyValueRow[] {
  if (!entries.length) {
    return emptyEnvRows(1);
  }
  return entries.map((e) => ({
    id: createEnvRowId(),
    key: e.key,
    value: e.value,
  }));
}

/**
 * Serializes key/value rows to dotenv text for uploadEnvProfile / updateEnvProfileContent.
 * Skips rows with empty keys.
 */
export function serializeEnvRows(rows: EnvKeyValueRow[]): string {
  return rows
    .filter((r) => r.key.trim())
    .map((r) => `${r.key.trim()}=${r.value}`)
    .join("\n");
}

/**
 * Parses dotenv text into editable rows (best-effort for UI; server validates on save).
 */
export function parseDotenvToRows(content: string): EnvKeyValueRow[] {
  const rows: EnvKeyValueRow[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    rows.push({
      id: createEnvRowId(),
      key: trimmed.slice(0, eq).trim(),
      value,
    });
  }
  return rows.length ? rows : emptyEnvRows(1);
}
