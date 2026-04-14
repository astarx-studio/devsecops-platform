/**
 * Type-safe application configuration loaded from environment variables.
 *
 * Required env vars are validated at startup — the app will fail to start
 * if any required variable is missing.
 *
 * @returns AppConfiguration object consumed via NestJS ConfigService
 */
export interface AppConfiguration {
  port: number;
  host: string;
  domain: string;
  appsDomain: string;
  gitlabDomain: string;
  apiKey?: string;
  logLevel: string;

  gitlab: {
    url: string;
    token: string;
    templateGroupId: number;
    configGroupId: number;
  };

  kong: {
    adminUrl: string;
  };

  vault: {
    url: string;
    token: string;
  };

  cloudflare: {
    apiToken?: string;
    zoneId?: string;
    tunnelId?: string;
  };

  oidc: {
    issuerUrl?: string;
    jwksUrl?: string;
    audience?: string;
  };
}

const configuration = (): AppConfiguration => {
  const required = (key: string): string => {
    const value = process.env[key];
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
  };

  const optional = (key: string): string | undefined => process.env[key];

  const domain = required('DOMAIN');

  return {
    port: Number.parseInt(optional('API_PORT') ?? '3000', 10),
    host: optional('API_HOST') ?? '0.0.0.0',
    domain,
    appsDomain: optional('APPS_DOMAIN') ?? `apps.${domain}`,
    gitlabDomain: optional('GITLAB_DOMAIN') ?? `gitlab.devops.${domain}`,
    apiKey: optional('API_KEY'),
    logLevel: optional('LOG_LEVEL') ?? 'info',

    gitlab: {
      url: optional('GITLAB_URL') ?? 'http://gitlab',
      token: required('GITLAB_ROOT_TOKEN'),
      templateGroupId: Number.parseInt(required('GITLAB_TEMPLATE_GROUP_ID'), 10),
      configGroupId: Number.parseInt(required('GITLAB_CONFIG_GROUP_ID'), 10),
    },

    kong: {
      adminUrl: optional('KONG_ADMIN_URL') ?? 'http://kong:8001',
    },

    vault: {
      url: optional('VAULT_URL') ?? 'http://vault:8200',
      token: required('VAULT_DEV_ROOT_TOKEN_ID'),
    },

    cloudflare: {
      apiToken: optional('CLOUDFLARE_API_TOKEN'),
      zoneId: optional('CLOUDFLARE_ZONE_ID'),
      tunnelId: optional('CLOUDFLARE_TUNNEL_ID'),
    },

    oidc: {
      issuerUrl: optional('OIDC_ISSUER_URL'),
      jwksUrl: optional('OIDC_JWKS_URL'),
      audience: optional('OIDC_AUDIENCE'),
    },
  };
};

export default configuration;
