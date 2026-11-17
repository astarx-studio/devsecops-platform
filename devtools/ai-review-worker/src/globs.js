import picomatch from 'picomatch';

// Branch and path globs. `*` stays inside one `/` segment, `**` crosses segments,
// plain names match exactly. Case-sensitive, like git refs.
const OPTS = { dot: true, nocase: false };

export function parseGlobList(value) {
  if (value == null) return [];
  const parts = Array.isArray(value) ? value : String(value).split(',');
  return parts.map((p) => String(p).trim()).filter((p) => p.length > 0);
}

export function matchesAny(name, globs) {
  if (!globs || globs.length === 0) return false;
  const subject = String(name ?? '');
  return globs.some((g) => picomatch.isMatch(subject, g, OPTS));
}

// X-Review-Only header present and non-empty replaces the config target rule.
export function targetBranchAllowed(targetBranch, reviewOnly, configTargets) {
  const header = parseGlobList(reviewOnly);
  if (header.length > 0) {
    return { allowed: matchesAny(targetBranch, header), source: 'X-Review-Only', globs: header };
  }
  const globs = parseGlobList(configTargets && configTargets.length ? configTargets : ['**']);
  return { allowed: matchesAny(targetBranch, globs), source: 'config target_branches', globs };
}
