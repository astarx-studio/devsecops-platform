import crypto from 'node:crypto';

// Renders the MR summary note, the inline comment bodies, and the Qestor
// notice. The summary note's first line is exactly `AI review for <sha>:` so
// n8n finds and updates it, and the item-list workflow ignores it.

export const MARKER = 'AI review for ';
export const INLINE_MARKER = '<!-- ai-review';

export function markerLine(sha) {
  return `${MARKER}${sha}:`;
}

const esc = (s) => String(s ?? '').replace(/\r/g, '');

// Wraps code-looking tokens in backticks, outside existing code spans and
// fences: calls `f(x)`, paths `a/b.ts`, dotted names `a.b.c`, snake_case,
// camelCase, and SCREAMING_CASE. Prose words are left alone.
const CODE_TOKEN = new RegExp(
  [
    String.raw`[A-Za-z_$][\w$.]*\([^()\s]{0,40}\)`,
    String.raw`(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,6}`,
    String.raw`[\w-]+\.(?:tsx?|jsx?|mjs|cjs|json|ya?ml|sql|md|py|go|rs|sh|css|html|vue)\b`,
    String.raw`[A-Za-z_$]\w*(?:\.[A-Za-z_$]\w*){2,}`,
    String.raw`[a-z][a-z0-9]*(?:_[a-z0-9]+)+`,
    String.raw`[a-z]+[a-z0-9]*[A-Z][A-Za-z0-9]*`,
    String.raw`[A-Z][A-Z0-9]*_[A-Z0-9_]+`,
  ].map((p) => `(?<![\\w\`/.])${p}(?![\\w\`])`).join('|'),
  'g',
);

export function formatCode(text) {
  const s = String(text ?? '');
  // Split into fenced blocks, inline spans, and plain text; only touch plain text.
  return s
    .split(/(```[\s\S]*?```|`[^`\n]+`|\[[^\]\n]*\]\([^)\s]*\)|https?:\/\/[^\s)>\]]+)/g)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(CODE_TOKEN, (m) => `\`${m}\``)))
    .join('');
}

const prose = (s, cfg) => (cfg.note.format_code ? formatCode(esc(s)) : esc(s));

// `webBase` is a string (this repo) or a function repo -> blob base URL, so
// findings in a related repository link into that repository at its head.
function location(f, webBase) {
  if (!f.file) return '';
  const repoLabel = f.repo ? `\`${f.repo}\` ` : '';
  const label = f.line ? `${f.file}:${f.line}` : f.file;
  const base = typeof webBase === 'function' ? webBase(f.repo || '') : f.repo ? '' : webBase;
  if (!base) return `${repoLabel}\`${label}\``;
  const anchor = f.line ? `#L${f.line}` : '';
  return `${repoLabel}[\`${label}\`](${base}/${f.file.split('/').map(encodeURIComponent).join('/')}${anchor})`;
}

export function diffBlock(diff, indent = '') {
  if (!diff) return '';
  const body = diff.split('\n').map((l) => `${indent}${l}`).join('\n');
  return `${indent}\`\`\`diff\n${body}\n${indent}\`\`\``;
}

function findings(list, webBase, cfg) {
  if (!list.length) return 'None';
  return list
    .map((f, i) => {
      const loc = location(f, webBase);
      const lines = [`${i + 1}. **${prose(f.title, cfg)}**${loc ? ` — ${loc}` : ''}`];
      if (f.detail) lines.push(`   - What and why: ${prose(f.detail, cfg).replace(/\n/g, '\n     ')}`);
      if (f.suggestion) lines.push(`   - Suggested fix: ${prose(f.suggestion, cfg).replace(/\n/g, '\n     ')}`);
      if (f.diff) lines.push('', diffBlock(f.diff, '   '));
      if (f.locationDropped) lines.push('   - The model gave a location that is not in the code, so it was removed.');
      return lines.join('\n');
    })
    .join('\n');
}

const ITEM_LABEL = { done: 'Done', partial: 'Partly done', missing: 'Not addressed', not_assessed: 'Not assessed', unverified: 'Not confirmed' };
const ITEM_ICON = { done: '✅', partial: '🟡', missing: '❌', not_assessed: '⚪', unverified: '🔍' };

const SECTION = {
  related_repos: (r) => {
    const repos = r.relatedRepos ?? [];
    const unmatched = r.relatedUnmatched ?? [];
    if (!repos.length && !unmatched.length) return '';
    const missed = unmatched.map((e) => `- \`${e}\`: matched no project or group the bot can read`);
    const rows = repos.map((p) =>
      p.mode === 'mr'
        ? `- \`${p.path}\`: paired MR [!${p.mr_iid}](${p.mr_url}) (${p.how}) at \`${p.head_sha.slice(0, 12)}\``
        : p.mode === 'branch'
          ? `- \`${p.path}\`: no paired MR, checked against \`${p.ref}\` (${p.how}) at \`${p.head_sha.slice(0, 12)}\``
          : `- \`${p.path}\`: ${esc(p.error || 'not available')}`,
    );
    return `### Related repositories\n${[...rows, ...missed].join('\n')}`;
  },
  match: (r, w, cfg) => {
    if (r.match.notJudged) return '### Match\nNot judged — no linked Qestor items, so the change was not checked against item requirements.';
    const rows = r.match.items.map((v) => {
      const id = v.url ? `[\`${v.public_id}\`](${v.url})` : `\`${v.public_id}\``;
      return `- ${ITEM_ICON[v.status]} ${id}${v.title ? ` ${esc(v.title)}` : ''} — **${ITEM_LABEL[v.status]}**${v.explanation ? `: ${prose(v.explanation, cfg)}` : ''}`;
    });
    const summary = r.match.explanation ? `\n\n${prose(r.match.explanation, cfg)}` : '';
    return `### Match\n${rows.join('\n')}${summary}`;
  },
  regression: (r, w, cfg) => {
    const head = `### Regression\nRisk: **${r.regression.risk}**${r.regression.explanation ? ` — ${prose(r.regression.explanation, cfg)}` : ''}`;
    if (!r.regression.affected.length) return head;
    const rows = r.regression.affected.map((a) => `- ${location(a, w) || 'unknown location'}: ${prose(a.detail, cfg)}`);
    return `${head}\n\nRelated code that may be affected:\n${rows.join('\n')}`;
  },
  blockers: (r, w, cfg) => `### Blockers\n${findings(r.blockers, w, cfg)}`,
  potential_bugs: (r, w, cfg) => `### Potential bugs\n${findings(r.potentialBugs, w, cfg)}`,
  recommendations: (r, w, cfg) => {
    if (!r.recommendations.length) return '### Recommendations\nNone';
    const rows = r.recommendations.map((x) => {
      const loc = location(x, w);
      const head = `- ${prose(x.text, cfg)}${loc ? ` — ${loc}` : ''}`;
      return x.diff ? `${head}\n\n${diffBlock(x.diff, '  ')}` : head;
    });
    return `### Recommendations\n${rows.join('\n')}`;
  },
};

function footer(meta) {
  const parts = [
    `model: ${meta.provider}/${meta.model}`,
    `context: ${meta.contextTokens}`,
    `read rounds: ${meta.readRounds}`,
    `duration: ${Math.round(meta.durationMs / 1000)}s`,
    `run: ${meta.runId}`,
  ];
  if (meta.inlineCount) parts.push(`inline comments: ${meta.inlineCount}`);
  if (meta.extras) parts.push('extra focus: on');
  if (meta.guardCount) parts.push(`guardrail findings: ${meta.guardCount}`);
  if (meta.diffTruncated) parts.push('diff truncated to fit');
  if (meta.relatedTruncated) parts.push('related code truncated');
  if (meta.reposTruncated) parts.push('related repositories truncated');
  return `\n---\n<sub>${parts.join(' · ')}</sub>`;
}

export function decisionLine(decision) {
  if (decision.action === 'approve') return '**Verdict: approved by the AI reviewer.** GitLab approval rules still apply.';
  return `**Verdict: not approved** — ${decision.reasons.join('; ')}.`;
}

export function renderReviewNote({ headSha, review, decision, cfg, meta, webBase }) {
  const out = [markerLine(headSha), '', decisionLine(decision), ''];
  for (const name of cfg.note.sections) {
    const text = SECTION[name](review, webBase, cfg);
    if (text) out.push(text, '');
  }
  if (cfg.note.show_footer) out.push(footer(meta));
  return out.join('\n').trimEnd() + '\n';
}

export function renderSimpleNote(headSha, text, meta) {
  const out = [markerLine(headSha), '', text];
  if (meta) out.push(footer(meta));
  return out.join('\n').trimEnd() + '\n';
}

export function renderQueuedNote(headSha, position) {
  return renderSimpleNote(headSha, `AI review queued${position > 0 ? ` (position ${position})` : ''}. This note will be updated with the result.`);
}

// Same kind, file and anchored line = same comment thread. The model rewords
// findings between runs, so wording is not part of the key; when the code
// moves, the old thread gets the stale reply and a new one opens.
export function fingerprint(kind, f, line = f.line) {
  const key = `${kind}|${f.repo ?? ''}|${f.file}|${line}`;
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 12);
}

const KIND_LABEL = { blockers: 'Blocker', potential_bugs: 'Potential bug', recommendations: 'Recommendation' };

// `suggestion` is a GitLab ```suggestion block (one-click apply); when set it
// replaces the diff block, since it shows the same change.
export function renderInlineBody(kind, f, fp, headSha, cfg, { suggestion = '' } = {}) {
  // Recommendations have no title: label in bold, text as a normal paragraph.
  const lines = f.title ? [`**${KIND_LABEL[kind]}: ${prose(f.title, cfg)}**`] : [`**${KIND_LABEL[kind]}**`, '', prose(f.text, cfg)];
  if (f.detail) lines.push('', prose(f.detail, cfg));
  if (f.suggestion) lines.push('', `Suggested fix: ${prose(f.suggestion, cfg)}`);
  if (suggestion) lines.push('', suggestion);
  else if (f.diff) lines.push('', diffBlock(f.diff));
  lines.push('', `<sub>AI review at \`${String(headSha).slice(0, 12)}\`</sub>`, `${INLINE_MARKER} fp=${fp} -->`);
  return lines.join('\n');
}

export function renderStaleReply(headSha) {
  return `Not reported anymore at \`${String(headSha).slice(0, 12)}\`.\n\n${INLINE_MARKER} stale -->`;
}

// Qestor item comment when a review rejects the MR. NOTE_URL is replaced by
// n8n with the link to the summary note once it exists.
export function renderQestorNotice({ job, review, decision, cfg }) {
  const sha12 = String(job.head_sha).slice(0, 12);
  const mr = job.web_url ? `[!${job.mr_iid} ${esc(job.title)}](${job.web_url})` : `!${job.mr_iid} ${esc(job.title)}`;
  const top = [...review.blockers.map((f) => ['Blocker', f]), ...review.potentialBugs.map((f) => ['Potential bug', f])].slice(0, cfg.qestor_notice.max_findings);
  const lines = [
    `**AI review rejected merge request ${mr}** at \`${sha12}\` in \`${job.project_path}\`.`,
    '',
    `Reason: ${decision.reasons.join('; ')}.`,
  ];
  if (top.length) {
    lines.push('', 'Top findings:');
    for (const [kind, f] of top) lines.push(`- ${kind}: ${prose(f.title, cfg)}${f.file ? ` (${f.repo ? `\`${f.repo}\` ` : ''}\`${f.file}${f.line ? `:${f.line}` : ''}\`)` : ''}`);
  }
  lines.push('', '[Read the full review and the line comments](NOTE_URL)', '', `<sub>${qestorDedupeKey(job)}</sub>`);
  return lines.join('\n');
}

// One notice per rejected head, and again when a paired head moved.
export function qestorDedupeKey(job) {
  const ctx = job.context_key ? ` with ${String(job.context_key).slice(0, 8)}` : '';
  return `ai-review ${job.project_path}!${job.mr_iid} at ${String(job.head_sha).slice(0, 12)}${ctx}`;
}
