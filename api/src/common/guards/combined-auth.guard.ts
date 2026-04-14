import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

import { AppConfiguration } from '../../config';

/**
 * Combined authentication guard that accepts EITHER:
 *   - A valid X-API-Key header matching the configured API_KEY, OR
 *   - A valid Bearer JWT token issued by Keycloak (validated via OIDC strategy)
 *
 * If API_KEY is not configured, requests without API key try JWT auth.
 * If neither mechanism succeeds, the request is rejected.
 * If neither mechanism is configured, all requests pass through.
 */
@Injectable()
export class CombinedAuthGuard implements CanActivate {
  private readonly logger = new Logger(CombinedAuthGuard.name);
  private readonly apiKey: string | undefined;
  private readonly oidcEnabled: boolean;

  constructor(configService: ConfigService<AppConfiguration>) {
    this.apiKey = configService.get<string>('apiKey');
    const oidcIssuer = configService.get<string>('oidc.issuerUrl', {
      infer: true,
    });
    this.oidcEnabled = !!oidcIssuer;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const headerKey = request.headers['x-api-key'] as string | undefined;
    const authHeader = request.headers['authorization'];

    // Try API key first
    if (headerKey) {
      if (this.apiKey && headerKey === this.apiKey) {
        this.logger.debug('Authenticated via API key');
        return true;
      }
      throw new UnauthorizedException('Invalid API key');
    }

    // Try JWT if OIDC is enabled and Bearer token is present
    if (authHeader?.startsWith('Bearer ') && this.oidcEnabled) {
      try {
        const jwtGuard = new (AuthGuard('oidc-jwt'))();
        const result = await jwtGuard.canActivate(context);
        if (result) {
          this.logger.debug('Authenticated via OIDC JWT');
          return true;
        }
      } catch (error) {
        this.logger.warn(`JWT validation failed: ${(error as Error).message}`);
        throw new UnauthorizedException('Invalid or expired JWT token');
      }
    }

    // If no auth mechanisms are configured, allow all (dev mode)
    if (!this.apiKey && !this.oidcEnabled) {
      this.logger.warn('No authentication configured — all requests allowed (dev mode)');
      return true;
    }

    throw new UnauthorizedException(
      'Authentication required: provide X-API-Key header or Bearer JWT token',
    );
  }
}
