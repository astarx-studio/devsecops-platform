import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';

/**
 * Logs inbound HTTP requests and their response times.
 * Provides trace-level visibility into API call durations.
 *
 * For GraphQL requests the label is derived from the operation type + path in
 * the GQL context, since HTTP-adapter request properties are not fully
 * populated for GraphQL executions.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startTime = Date.now();

    if (context.getType<GqlContextType>() === 'graphql') {
      const gqlCtx = GqlExecutionContext.create(context);
      const info = gqlCtx.getInfo<{ fieldName: string; path: { typename: string } }>();
      const label = `GQL ${info?.path?.typename ?? 'Query'}.${info?.fieldName ?? '?'}`;
      this.logger.debug(`--> ${label}`);

      return next.handle().pipe(
        tap(() => {
          const elapsed = Date.now() - startTime;
          this.logger.log(`<-- ${label} ${elapsed}ms`);
        }),
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    const { method, url } = request;

    this.logger.debug(`--> ${method} ${url}`);

    return next.handle().pipe(
      tap(() => {
        const elapsed = Date.now() - startTime;
        this.logger.log(`<-- ${method} ${url} ${elapsed}ms`);
      }),
    );
  }
}
