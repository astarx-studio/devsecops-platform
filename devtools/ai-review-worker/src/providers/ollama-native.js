import { postJson } from './index.js';

// Ollama /api/chat. num_ctx enforces the context size; `format` takes the schema.
export function ollamaNative(cfg) {
  const base = cfg.base_url.replace(/\/$/, '').replace(/\/v1$/, '');
  return {
    async chat({ system, messages, schema, maxTokens, signal }) {
      const body = {
        model: cfg.model,
        stream: false,
        messages: [{ role: 'system', content: system }, ...messages],
        format: cfg.structured_output === 'prompt' ? undefined : schema,
        options: { num_ctx: cfg.context_tokens, num_predict: maxTokens, temperature: cfg.temperature },
        ...cfg.extra_body,
      };
      const headers = { ...cfg.extra_headers };
      if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
      const { data, latencyMs } = await postJson(`${base}/api/chat`, body, { headers, timeoutMs: cfg.timeout_s * 1000, signal });
      return {
        text: data.message?.content ?? '',
        finishReason: data.done_reason,
        usage: { input: data.prompt_eval_count ?? 0, output: data.eval_count ?? 0 },
        latencyMs,
      };
    },
  };
}
