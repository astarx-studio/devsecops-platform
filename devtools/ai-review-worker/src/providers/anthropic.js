import { postJson } from './index.js';

// Anthropic Messages API. Structured output comes from one forced tool call
// whose input_schema is the step schema, so the reply is already parsed JSON.
export function anthropic(cfg) {
  const base = (cfg.base_url || 'https://api.anthropic.com').replace(/\/$/, '').replace(/\/v1$/, '');
  return {
    async chat({ system, messages, schema, schemaName, maxTokens, signal }) {
      const body = {
        model: cfg.model,
        max_tokens: maxTokens,
        temperature: cfg.temperature,
        system,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        tools: [{ name: schemaName, description: 'Submit your answer. Always call this tool exactly once.', input_schema: schema }],
        tool_choice: { type: 'tool', name: schemaName },
        ...cfg.extra_body,
      };
      const headers = { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', ...cfg.extra_headers };
      const { data, latencyMs } = await postJson(`${base}/v1/messages`, body, { headers, timeoutMs: cfg.timeout_s * 1000, signal });
      const tool = (data.content ?? []).find((c) => c.type === 'tool_use');
      const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      return {
        json: tool ? tool.input : undefined,
        text,
        finishReason: data.stop_reason,
        usage: { input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0 },
        latencyMs,
      };
    },
  };
}
