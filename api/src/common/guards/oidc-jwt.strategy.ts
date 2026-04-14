import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { passportJwtSecret } from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { AppConfiguration } from '../../config';

/**
 * Passport strategy that validates Keycloak-issued JWTs via the JWKS endpoint.
 *
 * Uses the internal Keycloak URL for JWKS retrieval (OIDC_JWKS_URL) but
 * validates the issuer against the external URL (OIDC_ISSUER_URL), since
 * tokens are issued with the external URL.
 *
 * Both OIDC_ISSUER_URL and OIDC_JWKS_URL must be set in the environment.
 * The app will fail to process JWTs if these are missing.
 */
@Injectable()
export class OidcJwtStrategy extends PassportStrategy(Strategy, 'oidc-jwt') {
  constructor(configService: ConfigService<AppConfiguration>) {
    const jwksUrl = configService.get<string>('oidc.jwksUrl', { infer: true });
    const issuerUrl = configService.get<string>('oidc.issuerUrl', { infer: true });

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKeyProvider: passportJwtSecret({
        jwksUri: jwksUrl!,
        cache: true,
        cacheMaxAge: 600000,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
      }),
      issuer: issuerUrl,
      algorithms: ['RS256'],
    });
  }

  /**
   * Called after JWT signature is verified. Returns the user object
   * that will be attached to the request.
   */
  validate(payload: Record<string, unknown>): Record<string, unknown> {
    return {
      sub: payload.sub,
      username: payload.preferred_username,
      email: payload.email,
      roles: payload.realm_roles ?? [],
    };
  }
}
