import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

import { CombinedAuthGuard } from './combined-auth.guard';
import { createMockConfigService } from '../../../test/helpers/mock-providers';

function createMockContext(headers: Record<string, string> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

describe('CombinedAuthGuard', () => {
  describe('API key authentication', () => {
    it('should pass with valid API key', async () => {
      const config = createMockConfigService({ apiKey: 'valid-key' });
      const guard = new CombinedAuthGuard(config);

      const context = createMockContext({ 'x-api-key': 'valid-key' });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('should reject with invalid API key', async () => {
      const config = createMockConfigService({ apiKey: 'valid-key' });
      const guard = new CombinedAuthGuard(config);

      const context = createMockContext({ 'x-api-key': 'wrong-key' });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('dev mode (no auth configured)', () => {
    it('should allow all requests when neither API key nor OIDC is configured', async () => {
      const config = createMockConfigService({
        apiKey: undefined,
        'oidc.issuerUrl': undefined,
      });
      const guard = new CombinedAuthGuard(config);

      const context = createMockContext({});

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });

  describe('missing credentials', () => {
    it('should reject when no credentials provided but API key is configured', async () => {
      const config = createMockConfigService({ apiKey: 'required-key' });
      const guard = new CombinedAuthGuard(config);

      const context = createMockContext({});

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Bearer token with OIDC disabled', () => {
    it('should reject Bearer token when OIDC is not configured', async () => {
      const config = createMockConfigService({
        apiKey: 'some-key',
        'oidc.issuerUrl': undefined,
      });
      const guard = new CombinedAuthGuard(config);

      const context = createMockContext({ authorization: 'Bearer some-jwt-token' });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });
});
