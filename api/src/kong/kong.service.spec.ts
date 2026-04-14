import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';

import type { AxiosResponse } from 'axios';

import { KongService } from './kong.service';
import { createMockConfigService } from '../../test/helpers/mock-providers';

function axiosResponse<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config: {} } as AxiosResponse<T>;
}

describe('KongService', () => {
  let service: KongService;

  /**
   * Standalone mock function references — avoids @typescript-eslint/unbound-method
   * when these are passed to `expect()`.
   */
  let putFn: jest.Mock;
  let deleteFn: jest.Mock;

  beforeEach(() => {
    putFn = jest.fn();
    deleteFn = jest.fn();

    service = new KongService(
      { get: jest.fn(), post: jest.fn(), put: putFn, delete: deleteFn } as unknown as HttpService,
      createMockConfigService(),
    );
  });

  describe('registerService', () => {
    it('should PUT service then PUT route', async () => {
      putFn.mockReturnValueOnce(of(axiosResponse({}))).mockReturnValueOnce(of(axiosResponse({})));

      const result = await service.registerService('my-svc', 'http://app:3000', ['app.test.net']);

      expect(result).toEqual({ serviceName: 'my-svc', hosts: ['app.test.net'] });
      expect(putFn).toHaveBeenCalledTimes(2);

      expect(putFn).toHaveBeenNthCalledWith(
        1,
        'http://kong:8001/services/my-svc',
        expect.objectContaining({ name: 'my-svc', url: 'http://app:3000' }),
      );

      expect(putFn).toHaveBeenNthCalledWith(
        2,
        'http://kong:8001/services/my-svc/routes/my-svc-route',
        expect.objectContaining({
          name: 'my-svc-route',
          hosts: ['app.test.net'],
          protocols: ['http', 'https'],
        }),
      );
    });
  });

  describe('removeService', () => {
    it('should DELETE route then DELETE service', async () => {
      deleteFn
        .mockReturnValueOnce(of(axiosResponse({})))
        .mockReturnValueOnce(of(axiosResponse({})));

      await service.removeService('my-svc');

      expect(deleteFn).toHaveBeenCalledTimes(2);
      expect(deleteFn).toHaveBeenNthCalledWith(
        1,
        'http://kong:8001/services/my-svc/routes/my-svc-route',
      );
      expect(deleteFn).toHaveBeenNthCalledWith(2, 'http://kong:8001/services/my-svc');
    });

    it('should handle missing route gracefully', async () => {
      deleteFn
        .mockReturnValueOnce(throwError(() => new Error('Not found')))
        .mockReturnValueOnce(of(axiosResponse({})));

      await expect(service.removeService('my-svc')).resolves.toBeUndefined();
      expect(deleteFn).toHaveBeenCalledTimes(2);
    });

    it('should handle missing service gracefully', async () => {
      deleteFn
        .mockReturnValueOnce(of(axiosResponse({})))
        .mockReturnValueOnce(throwError(() => new Error('Not found')));

      await expect(service.removeService('my-svc')).resolves.toBeUndefined();
    });
  });
});
