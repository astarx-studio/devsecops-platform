import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

import type { AppConfiguration } from '../../src/config';

/**
 * Default test configuration values used across all unit tests.
 * Mirrors the shape of AppConfiguration.
 */
const TEST_CONFIG: Record<string, unknown> = {
  port: 3000,
  host: '0.0.0.0',
  domain: 'test.net',
  appsDomain: 'apps.test.net',
  gitlabDomain: 'gitlab.devops.test.net',
  apiKey: 'test-api-key',
  logLevel: 'error',
  'gitlab.url': 'http://gitlab',
  'gitlab.token': 'test-gitlab-token',
  'gitlab.templateGroupId': 10,
  'gitlab.configGroupId': 20,
  'kong.adminUrl': 'http://kong:8001',
  'vault.url': 'http://vault:8200',
  'vault.token': 'test-vault-token',
  'cloudflare.apiToken': 'test-cf-token',
  'cloudflare.zoneId': 'test-cf-zone',
  'cloudflare.tunnelId': 'test-cf-tunnel',
  'oidc.issuerUrl': undefined,
  'oidc.jwksUrl': undefined,
  'oidc.audience': undefined,
};

export function createMockConfigService(
  overrides: Record<string, unknown> = {},
): ConfigService<AppConfiguration, false> {
  const config = { ...TEST_CONFIG, ...overrides };
  const get = jest.fn(<T = unknown>(key: string) => config[key] as T);
  return {
    get,
  } as unknown as ConfigService<AppConfiguration, false>;
}

/**
 * Creates a jest-mocked HttpService with the four HTTP verb methods stubbed.
 * Returned as the full `HttpService` type so it can be passed to NestJS service
 * constructors without additional casting at the call site.
 */
export function createMockHttpService(): jest.Mocked<HttpService> {
  return {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<HttpService>;
}

export { TEST_CONFIG };
