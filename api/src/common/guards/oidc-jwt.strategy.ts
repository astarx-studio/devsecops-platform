import { Injectable, UnauthorizedException } from '@nestjs/common';
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
  private readonly requiredGroup?: string;

  constructor(configService: ConfigService<AppConfiguration>) {
    const jwksUrl = configService.get<string>('oidc.jwksUrl', { infer: true });
    const issuerUrl = configService.get<string>('oidc.issuerUrl', { infer: true });
    const audience = configService.get<string>('oidc.audience', { infer: true });
    const requiredGroup = configService.get<string>('oidc.requiredGroup', { infer: true });

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
      ...(audience ? { audience } : {}),
    });
    this.requiredGroup = requiredGroup;
  }

  /**
   * Called after JWT signature is verified. Returns the user object
   * that will be attached to the request.
   */
  validate(payload: Record<string, unknown>): Record<string, unknown> {
    if (this.requiredGroup && !tokenHasGroup(payload, this.requiredGroup)) {
      throw new UnauthorizedException(
        `Token is missing required group or realm role "${this.requiredGroup}"`,
      );
    }

    const realmAccess = payload.realm_access as { roles?: string[] } | undefined;
    return {
      sub: payload.sub,
      username: payload.preferred_username,
      email: payload.email,
      roles: payload.realm_roles ?? realmAccess?.roles ?? [],
      groups: payload.groups ?? [],
    };
  }
}

function tokenHasGroup(payload: Record<string, unknown>, required: string): boolean {
  const groups = Array.isArray(payload.groups) ? payload.groups.map(String) : [];
  const realmRoles = Array.isArray(payload.realm_roles) ? payload.realm_roles.map(String) : [];
  const access = payload.realm_access as { roles?: unknown } | undefined;
  const accessRoles = Array.isArray(access?.roles) ? access.roles.map(String) : [];
  const names = [...groups, ...realmRoles, ...accessRoles];
  return names.some((name) => name === required || name.endsWith(`/${required}`));
}
