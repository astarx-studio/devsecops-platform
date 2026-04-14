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
  let postFn: jest.Mock;
  let deleteFn: jest.Mock;

  beforeEach(() => {
    postFn = jest.fn();
    deleteFn = jest.fn();

    service = new VaultService(
      { get: jest.fn(), post: postFn, put: jest.fn(), delete: deleteFn } as unknown as HttpService,
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

  describe('deleteSecrets', () => {
    it('should DELETE the metadata path', async () => {
      deleteFn.mockReturnValueOnce(of(axiosResponse({})));

      await service.deleteSecrets('projects/acme/webapp');

      expect(deleteFn).toHaveBeenCalledWith(
        'http://vault:8200/v1/secret/metadata/projects/acme/webapp',
        { headers: { 'X-Vault-Token': 'test-vault-token' } },
      );
    });

    it('should handle errors gracefully', async () => {
      deleteFn.mockReturnValueOnce(throwError(() => new Error('fail')));

      await expect(service.deleteSecrets('bad')).resolves.toBeUndefined();
    });
  });
});
