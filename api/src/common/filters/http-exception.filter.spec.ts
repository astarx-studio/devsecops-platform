import { ArgumentsHost, ContextType, HttpException, HttpStatus } from '@nestjs/common';

import { GlobalExceptionFilter } from './http-exception.filter';

interface FilterResponseBody {
  statusCode: number;
  message: string;
  path: string;
  timestamp: string;
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  /**
   * Explicitly typed to avoid `mock.calls[0][0]` being `any`.
   * The response body shape matches what GlobalExceptionFilter writes.
   */
  const mockJson = jest.fn<void, [FilterResponseBody]>();
  const mockStatus = jest.fn().mockReturnValue({ json: mockJson });

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    mockJson.mockClear();
    mockStatus.mockClear();
  });

  /**
   * Creates a fully-typed `ArgumentsHost` stub backed by simple function
   * implementations. Using method shorthand (rather than `jest.fn() as any`)
   * lets TypeScript verify the shape satisfies the interface without unsafe casts.
   */
  function createMockHost(url = '/test/path', method = 'GET'): ArgumentsHost {
    return {
      switchToHttp() {
        return {
          getResponse<T>() {
            return { status: mockStatus } as unknown as T;
          },
          getRequest<T>() {
            return { url, method } as unknown as T;
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
    };
  }

  it('should format HttpException with correct status code and message', () => {
    const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);

    filter.catch(exception, createMockHost());

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Not Found',
        path: '/test/path',
      }),
    );
  });

  it('should include a valid ISO timestamp in the response body', () => {
    const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);

    filter.catch(exception, createMockHost());

    const body = mockJson.mock.calls[0][0];
    expect(body.path).toBe('/test/path');
    expect(new Date(body.timestamp).getTime()).not.toBeNaN();
  });

  it('should handle unknown errors as 500 Internal Server Error', () => {
    const exception = new Error('Database connection failed');

    filter.catch(exception, createMockHost('/api/projects'));

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        path: '/api/projects',
      }),
    );
  });

  it('should not expose internal error details for 500 responses', () => {
    const exception = new Error('Sensitive internal error');

    filter.catch(exception, createMockHost());

    const body = mockJson.mock.calls[0][0];
    expect(body.message).not.toContain('Sensitive internal error');
  });

  it('should reflect the request URL in the path field', () => {
    const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);

    filter.catch(exception, createMockHost('/secure/resource'));

    const body = mockJson.mock.calls[0][0];
    expect(body.path).toBe('/secure/resource');
  });
});
