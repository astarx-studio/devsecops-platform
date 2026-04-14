import configuration from './configuration';

describe('configuration', () => {
  const requiredEnv: Record<string, string> = {
    DOMAIN: 'test.net',
    GITLAB_ROOT_TOKEN: 'glpat-test',
    GITLAB_TEMPLATE_GROUP_ID: '10',
    GITLAB_CONFIG_GROUP_ID: '20',
    VAULT_DEV_ROOT_TOKEN_ID: 'vault-test',
  };

  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function setRequiredEnv() {
    Object.assign(process.env, requiredEnv);
  }

  it('should return valid config when all required env vars are set', () => {
    setRequiredEnv();

    const config = configuration();

    expect(config.domain).toBe('test.net');
    expect(config.gitlab.token).toBe('glpat-test');
    expect(config.gitlab.templateGroupId).toBe(10);
    expect(config.gitlab.configGroupId).toBe(20);
    expect(config.vault.token).toBe('vault-test');
  });

  it('should fill defaults for optional vars', () => {
    setRequiredEnv();

    const config = configuration();

    expect(config.port).toBe(3000);
    expect(config.host).toBe('0.0.0.0');
    expect(config.appsDomain).toBe('apps.test.net');
    expect(config.gitlabDomain).toBe('gitlab.devops.test.net');
    expect(config.logLevel).toBe('info');
    expect(config.gitlab.url).toBe('http://gitlab');
    expect(config.kong.adminUrl).toBe('http://kong:8001');
    expect(config.vault.url).toBe('http://vault:8200');
  });

  it('should throw on missing DOMAIN', () => {
    setRequiredEnv();
    delete process.env.DOMAIN;

    expect(() => configuration()).toThrow('Missing required environment variable: DOMAIN');
  });

  it('should throw on missing GITLAB_ROOT_TOKEN', () => {
    setRequiredEnv();
    delete process.env.GITLAB_ROOT_TOKEN;

    expect(() => configuration()).toThrow(
      'Missing required environment variable: GITLAB_ROOT_TOKEN',
    );
  });

  it('should throw on missing GITLAB_TEMPLATE_GROUP_ID', () => {
    setRequiredEnv();
    delete process.env.GITLAB_TEMPLATE_GROUP_ID;

    expect(() => configuration()).toThrow(
      'Missing required environment variable: GITLAB_TEMPLATE_GROUP_ID',
    );
  });

  it('should throw on missing GITLAB_CONFIG_GROUP_ID', () => {
    setRequiredEnv();
    delete process.env.GITLAB_CONFIG_GROUP_ID;

    expect(() => configuration()).toThrow(
      'Missing required environment variable: GITLAB_CONFIG_GROUP_ID',
    );
  });

  it('should throw on missing VAULT_DEV_ROOT_TOKEN_ID', () => {
    setRequiredEnv();
    delete process.env.VAULT_DEV_ROOT_TOKEN_ID;

    expect(() => configuration()).toThrow(
      'Missing required environment variable: VAULT_DEV_ROOT_TOKEN_ID',
    );
  });

  it('should use override values for optional vars when provided', () => {
    setRequiredEnv();
    process.env.API_PORT = '8080';
    process.env.API_HOST = '127.0.0.1';
    process.env.APPS_DOMAIN = 'custom.apps.net';
    process.env.GITLAB_DOMAIN = 'gitlab.custom.net';
    process.env.API_KEY = 'my-api-key';
    process.env.LOG_LEVEL = 'debug';

    const config = configuration();

    expect(config.port).toBe(8080);
    expect(config.host).toBe('127.0.0.1');
    expect(config.appsDomain).toBe('custom.apps.net');
    expect(config.gitlabDomain).toBe('gitlab.custom.net');
    expect(config.apiKey).toBe('my-api-key');
    expect(config.logLevel).toBe('debug');
  });

  it('should load cloudflare optional config', () => {
    setRequiredEnv();
    process.env.CLOUDFLARE_API_TOKEN = 'cf-token';
    process.env.CLOUDFLARE_ZONE_ID = 'zone-123';
    process.env.CLOUDFLARE_TUNNEL_ID = 'tunnel-456';

    const config = configuration();

    expect(config.cloudflare.apiToken).toBe('cf-token');
    expect(config.cloudflare.zoneId).toBe('zone-123');
    expect(config.cloudflare.tunnelId).toBe('tunnel-456');
    expect((config.cloudflare as Record<string, unknown>)['accountId']).toBeUndefined();
  });

  it('should load OIDC optional config', () => {
    setRequiredEnv();
    process.env.OIDC_ISSUER_URL = 'https://auth.test/realms/devops';
    process.env.OIDC_JWKS_URL = 'https://auth.test/realms/devops/certs';
    process.env.OIDC_AUDIENCE = 'management-api';

    const config = configuration();

    expect(config.oidc.issuerUrl).toBe('https://auth.test/realms/devops');
    expect(config.oidc.jwksUrl).toBe('https://auth.test/realms/devops/certs');
    expect(config.oidc.audience).toBe('management-api');
  });
});
