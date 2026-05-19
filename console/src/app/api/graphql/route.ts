import { getManagementApiGraphqlUrl, getManagementApiKey } from '@/lib/server-config';

export async function POST(req: Request): Promise<Response> {
  const apiKey = getManagementApiKey();
  if (!apiKey) {
    return Response.json(
      { errors: [{ message: 'Management API key is not configured on the console server' }] },
      { status: 503 },
    );
  }

  const body = await req.text();
  let upstream: Response;
  try {
    upstream = await fetch(getManagementApiGraphqlUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body,
    });
  } catch {
    return Response.json(
      { errors: [{ message: 'Management API is unreachable from the console server' }] },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
