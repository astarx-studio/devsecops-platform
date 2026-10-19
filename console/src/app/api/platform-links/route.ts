import { NextResponse } from "next/server";

/** Public hostnames for deep links. No secrets. */
export function GET() {
  const gitlabDomain = process.env.GITLAB_DOMAIN?.trim();
  const vaultDomain = process.env.VAULT_DOMAIN?.trim();
  const appsDomain = process.env.APPS_DOMAIN?.trim();
  return NextResponse.json({
    gitlabBase: gitlabDomain ? `https://${gitlabDomain}` : null,
    vaultUi: vaultDomain ? `https://${vaultDomain}/ui/` : null,
    appsDomain: appsDomain || null,
    mcpEndpoint: process.env.DSOAAS_MCP_PUBLIC_URL?.trim() || null,
  });
}
