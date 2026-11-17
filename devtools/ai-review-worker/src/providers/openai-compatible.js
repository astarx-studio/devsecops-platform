import { postJson } from './index.js';

// OpenAI Chat Completions shape. Covers llama.cpp/llama-swap, LM Studio, vLLM,
// Ollama /v1, OpenAI, Kimi (Moonshot), OpenRouter, DeepSeek.
//
// structured_output:
//   json_schema — response_format json_schema (llama.cpp turns it into a grammar)
//   json_object — response_format json_object (Kimi, DeepSeek)
//   prompt      — no response_format; the schema is only in the prompt
export function openaiCompatible(cfg) {
  const base = cfg.base_url.replace(/\/$/, '');
  return {
    async chat({ system, messages, schema, schemaName, maxTokens, signal }) {
      const body = {
        model: cfg.model,
        messages: [{ role: 'system', content: system }, ...messages],
        max_tokens: maxTokens,
        temperature: cfg.temperature,
        stream: false,
        ...cfg.extra_body,
      };
      if (cfg.structured_output === 'json_schema') {
        body.response_format = { type: 'json_schema', json_schema: { name: schemaName, schema, strict: false } };
      } else if (cfg.structured_output === 'json_object') {
        body.response_format = { type: 'json_object' };
      }
      const headers = { ...cfg.extra_headers };
      if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
      const { data, latencyMs } = await postJson(`${base}/chat/completions`, body, { headers, timeoutMs: cfg.timeout_s * 1000, signal });
      const choice = data.choices?.[0];
      if (!choice) throw new Error('provider returned no choices');
      return {
        text: choice.message?.content ?? '',
        finishReason: choice.finish_reason,
        usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
        latencyMs,
      };
    },
  };
}
