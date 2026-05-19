import { getManagementApiHealthUrl, getManagementApiKey } from '@/lib/server-config';

export async function GET(): Promise<Response> {
  const apiKey = getManagementApiKey();
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }

  let upstream: Response;
  try {
    upstream = await fetch(getManagementApiHealthUrl(), { headers, cache: 'no-store' });
  } catch {
    return Response.json(
      { status: 'error', mongo: 'unreachable', vault: 'unreachable' },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
