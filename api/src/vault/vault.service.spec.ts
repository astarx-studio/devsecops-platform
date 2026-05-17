import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';

import type { AxiosResponse } from 'axios';

import { VaultService } from './vault.service';
import { createMockConfigService } from '../../test/helpers/mock-providers';

function axiosResponse<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config: {} } as AxiosResponse<T>;
}

describe('VaultService', () => {
  let service: VaultService;

  /**
   * Standalone mock function references — avoids @typescript-eslint/unbound-method
   * when these are passed to `expect()`.
   */
  let getFn: jest.Mock;
  let postFn: jest.Mock;
  let deleteFn: jest.Mock;

  beforeEach(() => {
    getFn = jest.fn();
    postFn = jest.fn();
    deleteFn = jest.fn();

    service = new VaultService(
      {
        get: getFn,
        post: postFn,
        put: jest.fn(),
        delete: deleteFn,
      } as unknown as HttpService,
      createMockConfigService(),
    );
  });

  describe('writeSecrets', () => {
    it('should POST secrets to the correct KV v2 path', async () => {
      postFn.mockReturnValueOnce(of(axiosResponse({})));

      await service.writeSecrets('projects/acme/webapp', { DB_URL: 'pg://...' });

      expect(postFn).toHaveBeenCalledWith(
        'http://vault:8200/v1/secret/data/projects/acme/webapp',
        { data: { DB_URL: 'pg://...' } },
        { headers: { 'X-Vault-Token': 'test-vault-token' } },
      );
    });
  });

  describe('readSecrets', () => {
    it('should return data from KV v2 read', async () => {
      getFn.mockReturnValueOnce(
        of(axiosResponse({ data: { data: { SONAR_TOKEN: 'sqp_test' } } })),
      );

      const secrets = await service.readSecrets('projects/acme/webapp/sonar');

      expect(secrets).toEqual({ SONAR_TOKEN: 'sqp_test' });
    });

    it('should return empty object on 404', async () => {
      getFn.mockReturnValueOnce(throwError(() => ({ response: { status: 404 } })));

      const secrets = await service.readSecrets('missing');

      expect(secrets).toEqual({});
    });
  });

  describe('deleteSecrets', () => {
    it('should DELETE the metadata path', async () => {
      deleteFn.mockReturnValueOnce(of(axiosResponse({})));

      const ok = await service.deleteSecrets('projects/acme/webapp');

      expect(ok).toBe(true);
      expect(deleteFn).toHaveBeenCalledWith(
        'http://vault:8200/v1/secret/metadata/projects/acme/webapp',
        { headers: { 'X-Vault-Token': 'test-vault-token' } },
      );
    });

    it('should return false on delete failure', async () => {
      deleteFn.mockReturnValueOnce(throwError(() => new Error('fail')));

      const ok = await service.deleteSecrets('bad');

      expect(ok).toBe(false);
    });
  });

  describe('deleteSecretsTree', () => {
    it('should delete child env paths and base path', async () => {
      getFn.mockReturnValueOnce(
        of(axiosResponse({ data: { keys: ['dev/', 'stg/', 'sonar'] } })),
      );
      getFn.mockReturnValue(of(axiosResponse({ data: { keys: [] } })));
      deleteFn.mockReturnValue(of(axiosResponse({})));

      const result = await service.deleteSecretsTree('projects/acme/webapp');

      expect(result.errors).toEqual([]);
      expect(result.deleted).toBeGreaterThan(0);
      expect(deleteFn).toHaveBeenCalledWith(
        'http://vault:8200/v1/secret/metadata/projects/acme/webapp/dev',
        expect.any(Object),
      );
      expect(deleteFn).toHaveBeenCalledWith(
        'http://vault:8200/v1/secret/metadata/projects/acme/webapp',
        expect.any(Object),
      );
    });
  });
});
