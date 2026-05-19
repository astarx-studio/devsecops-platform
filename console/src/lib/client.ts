import type { GraphqlResponse } from '@/lib/types';

/** Browser-side GraphQL via Next.js BFF (no API key in the client). */
export async function graphqlRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch('/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  const json = (await res.json()) as GraphqlResponse<T>;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '));
  }
  if (json.data === undefined) {
    throw new Error('GraphQL response missing data');
  }
  return json.data;
}

/** Management API health via BFF. */
export async function checkHealth(): Promise<{ status: string; mongo?: string; vault?: string }> {
  const res = await fetch('/api/health');
  if (!res.ok) {
    throw new Error(`Health check failed: HTTP ${res.status}`);
  }
  return res.json() as Promise<{ status: string; mongo?: string; vault?: string }>;
}
