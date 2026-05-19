/** Server-only Management API settings (never import from client components). */

export function getManagementApiGraphqlUrl(): string {
  return process.env.MANAGEMENT_API_GRAPHQL_URL ?? 'http://localhost:13000/graphql';
}

export function getManagementApiHealthUrl(): string {
  const graphql = getManagementApiGraphqlUrl();
  return graphql.replace(/\/graphql\/?$/, '/health');
}

export function getManagementApiKey(): string | undefined {
  const key = process.env.API_KEY?.trim();
  return key || undefined;
}
