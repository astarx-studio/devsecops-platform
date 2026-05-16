import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Global HTTP exception filter that standardizes REST error responses.
 *
 * GraphQL resolver exceptions are intentionally skipped — they are handled
 * by Apollo's own error formatter, which converts them to GraphQL-spec errors
 * in the response body. Intercepting them here would call `switchToHttp()`
 * on a GraphQL `ArgumentsHost`, which returns an incomplete request object
 * and causes "Cannot read properties of undefined (reading 'url')" crashes.
 *
 * For HTTP exceptions whose `getResponse()` is an object (not only a string),
 * that object is merged into the JSON body so callers receive structured
 * fields (for example `graphqlEndpoint` on deprecated REST project writes).
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    // Let the GraphQL layer handle its own errors; skip to avoid HTTP adapter issues.
    if ((host.getType() as string) === 'graphql') {
      throw exception;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const timestamp = new Date().toISOString();
    const path = request.url;

    /** Standard fields plus any payload from `HttpException` (e.g. 410 Gone hints). */
    const errorResponse: Record<string, unknown> = {
      statusCode: status,
      timestamp,
      path,
    };

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'string') {
        errorResponse.message = body;
      } else if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
        Object.assign(errorResponse, body as Record<string, unknown>);
        errorResponse.statusCode = (body as { statusCode?: number }).statusCode ?? status;
        errorResponse.timestamp = timestamp;
        errorResponse.path = path;
      } else {
        errorResponse.message = exception.message;
      }
    } else {
      errorResponse.message = 'Internal server error';
    }

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} ${status} - ${formatErrorMessageForLog(errorResponse.message)}`,
      );
    }

    response.status(status).json(errorResponse);
  }
}

function formatErrorMessageForLog(message: unknown): string {
  if (typeof message === 'string') {
    return message;
  }
  if (Array.isArray(message)) {
    return message.map((m) => String(m)).join(', ');
  }
  if (message !== null && message !== undefined && typeof message === 'object') {
    return JSON.stringify(message);
  }
  if (typeof message === 'number' || typeof message === 'boolean' || typeof message === 'bigint') {
    return String(message);
  }
  return '';
}
