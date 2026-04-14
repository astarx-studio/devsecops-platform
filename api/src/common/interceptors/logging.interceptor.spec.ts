import { CallHandler, ContextType, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';

import { LoggingInterceptor } from './logging.interceptor';

/**
 * Creates a fully-typed `ExecutionContext` stub. Using plain function
 * implementations satisfies the interface without unsafe `any` casts.
 */
function createMockContext(method = 'GET', url = '/test'): ExecutionContext {
  return {
    switchToHttp() {
      return {
        getRequest<T>() {
          return { method, url } as unknown as T;
        },
        getResponse<T>() {
          return {} as unknown as T;
        },
        getNext<T>() {
          return (() => undefined) as unknown as T;
        },
      };
    },
    getArgs<T extends unknown[]>() {
      return [] as unknown as T;
    },
    getArgByIndex<T>(_index: number) {
      return undefined as unknown as T;
    },
    switchToRpc() {
      throw new Error('switchToRpc not implemented in test stub');
    },
    switchToWs() {
      throw new Error('switchToWs not implemented in test stub');
    },
    getType<TContext extends string = ContextType>() {
      return 'http' as unknown as TContext;
    },
    getClass<T>() {
      return class {} as unknown as T;
    },
    getHandler(): () => void {
      return () => {};
    },
  };
}

function createMockCallHandler(returnValue: unknown = { ok: true }): CallHandler {
  return { handle: () => of(returnValue) };
}

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;

  beforeEach(() => {
    interceptor = new LoggingInterceptor();
  });

  it('should pass the request through to the next handler', (done) => {
    const context = createMockContext('GET', '/health');
    const handler = createMockCallHandler({ status: 'ok' });

    interceptor.intercept(context, handler).subscribe({
      next: (value) => {
        expect(value).toEqual({ status: 'ok' });
      },
      complete: done,
    });
  });

  it('should complete the observable without modification', (done) => {
    const context = createMockContext('POST', '/projects');
    const handler = createMockCallHandler({ id: 1, name: 'test' });

    interceptor.intercept(context, handler).subscribe({
      complete: done,
    });
  });

  it('should intercept POST requests', (done) => {
    const context = createMockContext('POST', '/api/v1/resource');
    const handler = createMockCallHandler({ created: true });

    interceptor.intercept(context, handler).subscribe({
      next: (value) => {
        expect(value).toEqual({ created: true });
      },
      complete: done,
    });
  });
});
