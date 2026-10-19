import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import { Observable } from 'rxjs';

import type { Request } from 'express';

import { auditActorAls } from './audit-actor.context';

/**
 * Stamps audit writes with api-key or the OIDC subject for the current request.
 * The Management API BFF uses a shared API key, so console actions are attributed as `api-key`
 * until per-operator tokens are forwarded.
 */
@Injectable()
export class AuditActorInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = this.requestFrom(context) as
      | (Request & { user?: { username?: string; sub?: string } })
      | undefined;
    const user = request?.user;
    let actor = 'unknown';
    if (user?.username || user?.sub) {
      actor = `oidc:${user.username ?? user.sub}`;
    } else if (request?.headers?.['x-api-key']) {
      actor = 'api-key';
    }

    return auditActorAls.run({ actor }, () => next.handle());
  }

  private requestFrom(context: ExecutionContext): Request | undefined {
    if (context.getType<GqlContextType>() === 'graphql') {
      return GqlExecutionContext.create(context).getContext<{ req: Request }>().req;
    }
    return context.switchToHttp().getRequest<Request>();
  }
}
