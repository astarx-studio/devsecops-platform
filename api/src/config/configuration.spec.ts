import configuration from './configuration';

describe('configuration', () => {
  const requiredEnv: Record<string, string> = {
    DOMAIN: 'test.net',
    GITLAB_ROOT_TOKEN: 'glpat-test',
    GITLAB_TEMPLATE_GROUP_ID: '10',
    GITLAB_CONFIG_GROUP_ID: '20',
    VAULT_ROOT_TOKEN: 'vault-test',
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
    expect(config.vault.url).toBe('http://vault:8200');
    expect(config.mongo.url).toBe('mongodb://mongo:27017');
    expect(config.mongo.dbName).toBe('platform');
    expect(config.kube.configDir).toBe('/etc/dsoaas/kubeconfigs');
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

  it('should throw on missing VAULT_ROOT_TOKEN', () => {
    setRequiredEnv();
    delete process.env.VAULT_ROOT_TOKEN;

    expect(() => configuration()).toThrow(
      'Missing required environment variable: VAULT_ROOT_TOKEN',
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

  it('should load Mongo + Kube optional config overrides', () => {
    setRequiredEnv();
    process.env.MONGO_URL = 'mongodb://custom-host:27017';
    process.env.MONGO_DB_NAME = 'mydb';
    process.env.KUBE_API_INTERNAL_URL = 'https://k3d-server:6443';
    process.env.KUBECONFIG_DIR = '/custom/kubeconfigs';

    const config = configuration();

    expect(config.mongo.url).toBe('mongodb://custom-host:27017');
    expect(config.mongo.dbName).toBe('mydb');
    expect(config.kube.apiUrl).toBe('https://k3d-server:6443');
    expect(config.kube.configDir).toBe('/custom/kubeconfigs');
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
