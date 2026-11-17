// Extra Qestor ids the model asks for go through an internal n8n webhook, so
// the Qestor credential stays in n8n. Only HTTP 200 items come back.
export function createQestorLookup(env) {
  const url = env.AI_REVIEW_QESTOR_LOOKUP_URL;
  if (!url) return async () => { throw new Error('Qestor lookup is not configured'); };
  return async (ids) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ai-review-token': env.AI_REVIEW_QESTOR_LOOKUP_TOKEN ?? '' },
      body: JSON.stringify({ ids }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Qestor lookup answered ${res.status}`);
    const data = await res.json();
    const items = Array.isArray(data) ? data : data.items ?? [];
    return items.filter((i) => i && i.found !== false);
  };
}
