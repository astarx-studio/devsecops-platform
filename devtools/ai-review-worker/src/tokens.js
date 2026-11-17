// Conservative token estimate. Code tokenizes denser than prose, so 3 chars per
// token keeps the real count under the budget for most tokenizers.
export const CHARS_PER_TOKEN = 3;

export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / CHARS_PER_TOKEN);
}

export function messagesTokens(messages) {
  // ~6 tokens of chat-template overhead per message.
  return messages.reduce((n, m) => n + estimateTokens(m.content) + 6, 0);
}

// Cuts text to fit `maxTokens`, keeping the head, and says how much was cut.
export function truncateToTokens(text, maxTokens, label = 'content') {
  const s = String(text ?? '');
  if (maxTokens <= 0) return { text: `[${label} omitted: no context budget left]`, truncated: s.length > 0 };
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (s.length <= maxChars) return { text: s, truncated: false };
  const note = `\n[${label} truncated: ${s.length - maxChars + 80} of ${s.length} characters cut to fit the context]`;
  return { text: s.slice(0, Math.max(0, maxChars - note.length)) + note, truncated: true };
}

// Input budget for one request: context minus the reply and a safety margin.
export function inputBudget(cfg) {
  return cfg.model.context_tokens - cfg.model.max_output_tokens - 128;
}
