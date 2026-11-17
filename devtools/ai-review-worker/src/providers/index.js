import { openaiCompatible } from './openai-compatible.js';
import { anthropic } from './anthropic.js';
import { ollamaNative } from './ollama-native.js';

// Every adapter implements:
//   chat({ system, messages, schema, schemaName, maxTokens, signal })
//     -> { text?: string, json?: object, usage: { input, output }, latencyMs }
// `messages` alternate user/assistant and hold plain text; adapters map them.
// Adding a provider = one file here plus an entry in ADAPTERS.

const ADAPTERS = {
  'openai-compatible': openaiCompatible,
  anthropic,
  'ollama-native': ollamaNative,
};

export function createProvider(modelCfg, env = process.env) {
  const make = ADAPTERS[modelCfg.provider];
  if (!make) throw new Error(`unknown provider ${modelCfg.provider}`);
  const apiKey = modelCfg.api_key_env ? env[modelCfg.api_key_env] : '';
  if (modelCfg.api_key_env && !apiKey) throw new Error(`env ${modelCfg.api_key_env} is not set for provider ${modelCfg.provider}`);
  return { name: modelCfg.provider, model: modelCfg.model, ...make({ ...modelCfg, apiKey }) };
}

export async function postJson(url, body, { headers = {}, timeoutMs, signal }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`request timed out after ${timeoutMs} ms`)), timeoutMs);
  const onAbort = () => ctrl.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${url} answered ${res.status}: ${text.slice(0, 500)}`);
    return { data: JSON.parse(text), latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
