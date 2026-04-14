import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';

import type { AxiosResponse } from 'axios';

import { CloudflareService } from './cloudflare.service';
import { createMockConfigService } from '../../test/helpers/mock-providers';

function axiosResponse<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config: {} } as AxiosResponse<T>;
}

describe('CloudflareService', () => {
  /**
   * Standalone mock function references — avoids @typescript-eslint/unbound-method
   * when these are passed to `expect()`.
   */
  let getFn: jest.Mock;
  let postFn: jest.Mock;
  let deleteFn: jest.Mock;

  function createService(overrides: Record<string, unknown> = {}) {
    getFn = jest.fn();
    postFn = jest.fn();
    deleteFn = jest.fn();

    return new CloudflareService(
      { get: getFn, post: postFn, put: jest.fn(), delete: deleteFn } as unknown as HttpService,
      createMockConfigService(overrides),
    );
  }

  describe('when fully configured', () => {
    let service: CloudflareService;

    beforeEach(() => {
      service = createService();
    });

    describe('addDnsRecord', () => {
      it('should create a CNAME record and return true', async () => {
        postFn.mockReturnValueOnce(of(axiosResponse({ success: true })));

        const result = await service.addDnsRecord('app.test.net');

        expect(result).toBe(true);
        expect(postFn).toHaveBeenCalledWith(
          'https://api.cloudflare.com/client/v4/zones/test-cf-zone/dns_records',
          expect.objectContaining({
            type: 'CNAME',
            name: 'app.test.net',
            content: 'test-cf-tunnel.cfargotunnel.com',
            proxied: true,
          }),
          expect.objectContaining({
            headers: { Authorization: 'Bearer test-cf-token' },
          }),
        );
      });

      it('should return false when API call fails', async () => {
        postFn.mockReturnValueOnce(throwError(() => new Error('API error')));

        const result = await service.addDnsRecord('app.test.net');

        expect(result).toBe(false);
      });
    });

    describe('removeDnsRecord', () => {
      it('should list then delete matching records', async () => {
        getFn.mockReturnValueOnce(of(axiosResponse({ result: [{ id: 'rec-1' }] })));
        deleteFn.mockReturnValueOnce(of(axiosResponse({})));

        const result = await service.removeDnsRecord('app.test.net');

        expect(result).toBe(true);
        expect(getFn).toHaveBeenCalledWith(
          'https://api.cloudflare.com/client/v4/zones/test-cf-zone/dns_records',
          expect.objectContaining({
            params: { name: 'app.test.net', type: 'CNAME' },
          }),
        );
        expect(deleteFn).toHaveBeenCalledWith(
          'https://api.cloudflare.com/client/v4/zones/test-cf-zone/dns_records/rec-1',
          expect.any(Object),
        );
      });

      it('should return false when no records found', async () => {
        getFn.mockReturnValueOnce(of(axiosResponse({ result: [] })));

        const result = await service.removeDnsRecord('missing.test.net');

        expect(result).toBe(false);
        expect(deleteFn).not.toHaveBeenCalled();
      });

      it('should return false on error', async () => {
        getFn.mockReturnValueOnce(throwError(() => new Error('API error')));

        const result = await service.removeDnsRecord('app.test.net');

        expect(result).toBe(false);
      });
    });
  });

  describe('when not configured (missing apiToken)', () => {
    let service: CloudflareService;

    beforeEach(() => {
      service = createService({
        'cloudflare.apiToken': undefined,
        'cloudflare.zoneId': undefined,
      });
    });

    it('addDnsRecord should return false without making API calls', async () => {
      const result = await service.addDnsRecord('app.test.net');

      expect(result).toBe(false);
      expect(postFn).not.toHaveBeenCalled();
    });

    it('removeDnsRecord should return false without making API calls', async () => {
      const result = await service.removeDnsRecord('app.test.net');

      expect(result).toBe(false);
      expect(getFn).not.toHaveBeenCalled();
    });
  });
});
