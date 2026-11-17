// Guardrails. Everything here is deterministic: it does not depend on the
// model behaving, so a prompt-injected or confused model can't get past it.
//
// Outgoing text (MR notes, line comments, Qestor comments):
//   - GitLab quick actions (`/merge`, `/approve`, `/close`…) are neutralized.
//     The bot posts as a Maintainer; a line starting with `/` would run.
//   - @mentions are wrapped in backticks, so the model can't ping people.
//   - Images are removed and links to hosts outside the allow-list become
//     plain text (no tracking pixels, no phishing links).
//   - Raw HTML is stripped, except our own `<sub>` and `<!-- ai-review` markers.
//   - Secrets are redacted.
//   - Length is capped per destination.
// Incoming text (diff, related code, items, descriptions):
//   - Secrets are redacted before anything reaches the model.
//   - Added lines are scanned for secrets and prompt-injection phrases; hits
//     become findings the model can't remove.

const SECRET_PATTERNS = [
  ['GitLab token', /\bglpat-[0-9A-Za-z_-]{20,}\b/g],
  ['GitLab token', /\bgl(?:dt|rt|ptt|ft|soat|cbt|imt|agent|oas)-[0-9A-Za-z_-]{20,}\b/g],
  ['Qestor token', /\bqs[tm]_[0-9A-Za-z_-]{16,}\b/g],
  ['GitHub token', /\bgh[pousr]_[0-9A-Za-z]{30,}\b/g],
  ['Slack token', /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/g],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['API key', /\bsk-(?:ant-|proj-)?[0-9A-Za-z_-]{20,}\b/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g],
  ['bearer token', /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/g],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
  ['connection string password', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:([^\s@/]{6,})@/gi],
  ['password or secret', /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*['"]([^'"\s]{8,})['"]/gi],
];

// Values that are obviously placeholders are not secrets.
const PLACEHOLDER = /^(?:change-?me|changeme|example|placeholder|dummy|test|xxx+|\*+|\$\{[^}]*\}|<[^>]*>|your[_-].*|redacted)$/i;

export function redactSecrets(text) {
  let s = String(text ?? '');
  let count = 0;
  for (const [, re] of SECRET_PATTERNS) {
    re.lastIndex = 0;
    s = s.replace(re, (m, ...rest) => {
      // Without a capture group, the second argument is the match offset.
      const g1 = typeof rest[0] === 'string' ? rest[0] : null;
      if (g1 && PLACEHOLDER.test(g1)) return m;
      count++;
      if (g1) return m.replace(g1, '[redacted]');
      return `[redacted ${m.length > 12 ? m.slice(0, 4) : ''}…]`;
    });
  }
  return { text: s, count };
}

// Secrets in added lines become blocker findings (masked, with location).
export function scanSecrets(files, ignoreFile = () => false) {
  const out = [];
  for (const f of files) {
    if (ignoreFile(f.newPath)) continue;
    for (const [line, info] of f.newLines) {
      if (info.type !== 'added') continue;
      const text = lineText(f, line);
      if (text == null) continue;
      for (const [kind, re] of SECRET_PATTERNS) {
        re.lastIndex = 0;
        const m = re.exec(text);
        if (!m) continue;
        if (m[1] && PLACEHOLDER.test(m[1])) continue;
        out.push({ kind, file: f.newPath, line });
        break;
      }
    }
  }
  return out;
}

// Phrases aimed at the reviewer rather than at the code's readers.
const INJECTION = [
  /\b(?:ignore|disregard|forget|override)\b[^\n]{0,40}\b(?:previous|prior|above|earlier|all|any|your|system)\b[^\n]{0,20}\b(?:instructions?|rules?|prompts?|guidelines?)\b/i,
  /\b(?:you are|act as|pretend to be|from now on you)\b[^\n]{0,30}\b(?:ai|assistant|reviewer|model|llm|gpt|claude|bonsai)\b/i,
  /\b(?:system|developer)\s+(?:prompt|message|instructions?)\b/i,
  /\b(?:approve|lgtm)\b[^\n]{0,30}\b(?:this|the)\s+(?:mr|merge request|pull request|pr|change)\b/i,
  // An order to the reviewer, in the same sentence: "the AI reviewer must approve…".
  /\b(?:ai|automated|bot)\s+review(?:er)?s?\b[^\n.!?]{0,40}\b(?:must|should|shall|will|need to|has to|is to)\s+(?:not\s+)?(?:approve|ignore|skip|output|reply|respond|return|mark|say|pass|accept|report|flag|list)\b/i,
  /\b(?:do not|don't|never)\s+(?:report|flag|mention|list)\b[^\n]{0,40}\b(?:bugs?|issues?|blockers?|findings?|this)\b/i,
  /["']?(?:action|blockers|potentialBugs)["']?\s*:\s*(?:\[\s*\]|["']review["'])/i,
  /<\/?\s*untrusted\b/i,
  /\[\s*(?:system|assistant|inst)\s*\]|<\|(?:im_start|im_end|system|assistant)\|>/i,
];

export function injectionHits(text) {
  const s = String(text ?? '');
  return INJECTION.some((re) => re.test(s));
}

// Scans added lines plus MR/item text. Returns [{ where, file, line, sample }].
export function scanInjection({ files, extraTexts = [] }) {
  const out = [];
  for (const f of files) {
    for (const [line, info] of f.newLines) {
      if (info.type !== 'added') continue;
      const text = lineText(f, line);
      if (text && injectionHits(text)) out.push({ where: 'diff', file: f.newPath, line, sample: text.trim().slice(0, 120) });
    }
  }
  for (const { where, text } of extraTexts) {
    for (const l of String(text ?? '').split('\n')) {
      if (injectionHits(l)) {
        out.push({ where, file: '', line: 0, sample: l.trim().slice(0, 120) });
        break;
      }
    }
  }
  return out;
}

// The text of an added line (diffparse keeps it on the line map).
function lineText(f, newLine) {
  return f.newLines.get(newLine)?.text ?? null;
}

// --- Outgoing text -----------------------------------------------------------

const FENCE = /^(\s*)(`{3,}|~{3,})/;

// Splits text into code (fenced blocks, inline spans) and prose, and only
// rewrites prose. Quick actions inside code blocks don't run in GitLab.
function mapProse(text, fn) {
  const lines = String(text ?? '').split('\n');
  const out = [];
  let fence = null;
  for (const line of lines) {
    const m = line.match(FENCE);
    if (fence) {
      out.push(line);
      if (m && m[2][0] === fence[0] && m[2].length >= fence.length) fence = null;
      continue;
    }
    if (m) {
      fence = m[2];
      out.push(line);
      continue;
    }
    // Outside fences: keep inline code spans untouched.
    out.push(line.split(/(`[^`\n]+`)/g).map((part, i) => (i % 2 ? part : fn(part))).join(''));
  }
  return out.join('\n');
}

// Quick actions: a line whose first non-space character is `/` followed by a
// word. Checked on whole lines, after prose rewriting.
function neutralizeQuickActions(text) {
  const lines = String(text).split('\n');
  let fence = null;
  return lines
    .map((line) => {
      const m = line.match(FENCE);
      if (fence) {
        if (m && m[2][0] === fence[0] && m[2].length >= fence.length) fence = null;
        return line;
      }
      if (m) {
        fence = m[2];
        return line;
      }
      return line.replace(/^(\s*(?:[-*+>]\s+|\d+[.)]\s+)*)(\/[A-Za-z_][\w-]*)/, (all, lead, cmd) => `${lead}\`${cmd}\``);
    })
    .join('\n');
}

function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

export function sanitizeOutgoing(text, { linkHosts = [], maxLength = 900000 } = {}) {
  const allowed = new Set(linkHosts.map((h) => h.toLowerCase()));
  const okHost = (u) => {
    const h = hostOf(u);
    return h && [...allowed].some((a) => h === a || h.endsWith(`.${a}`));
  };
  let s = redactSecrets(text).text;
  s = mapProse(s, (p) =>
    p
      // Images: removed (tracking pixels, injected content).
      .replace(/!\[([^\]\n]*)\]\(([^)\s]*)[^)]*\)/g, (_, alt) => (alt ? `[image removed: ${alt}]` : '[image removed]'))
      // Links: kept only for allowed hosts and relative paths.
      .replace(/\[([^\]\n]*)\]\(([^)\s]+)([^)]*)\)/g, (all, label, url) => (url.startsWith('/') || url.startsWith('#') || okHost(url) ? all : `${label} (external link removed)`))
      // Bare URLs to other hosts lose the scheme so they don't autolink.
      .replace(/\bhttps?:\/\/[^\s)>\]]+/g, (u) => (okHost(u) ? u : `\`${u.replace(/^https?:\/\//, '')}\``))
      // Raw HTML, except our markers.
      .replace(/<(?!\/?sub>|!-- ai-review)\/?[A-Za-z][^>\n]*>/g, '')
      // @mentions (users, groups, @all) can't ping anyone.
      .replace(/(^|[^\w`])@([A-Za-z0-9_][A-Za-z0-9_.-]*)/g, (_, pre, name) => `${pre}\`@${name}\``),
  );
  s = neutralizeQuickActions(s);
  if (s.length > maxLength) s = `${s.slice(0, maxLength - 60)}\n\n[truncated: the review is longer than this destination allows]`;
  return s;
}

// --- Incoming header values ---------------------------------------------------

// Comma lists (X-Review-Only, X-Review-Related): bounded and charset-checked.
export function cleanListHeader(value, { maxLength = 1000, maxEntries = 30 } = {}) {
  const s = String(value ?? '').slice(0, maxLength);
  return s
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x && /^!?[A-Za-z0-9_.*?/{}[\]:-]+$/.test(x))
    .slice(0, maxEntries)
    .join(', ');
}

// X-Review-Extras: free text from the webhook. Headers are one line, so a
// literal `\n` means a newline. Control characters and our fence tags are
// removed and the length is capped. It is operator text, but it only adds
// focus: the system prompt says it can't relax the standard.
export function cleanExtras(value, maxLength = 2000) {
  return String(value ?? '')
    .replace(/\\n/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/<\/?\s*untrusted[^>]*>/gi, '')
    .trim()
    .slice(0, maxLength);
}
