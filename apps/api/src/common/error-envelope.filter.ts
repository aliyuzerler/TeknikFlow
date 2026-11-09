import { randomUUID } from 'node:crypto';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

/**
 * Tüm hataları docs/API_CONVENTIONS.md'deki zarfa sarar:
 * { code, message, requestId, statusCode, fieldErrors? } — yığın izi sızdırmaz.
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorEnvelopeFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const requestId = readRequestId(request);
    const envelope = mapException(exception, requestId);

    // Sunucu tarafında tam hata; istemciye yalnızca zarf gider.
    this.logger.error(
      `requestId=${requestId} ${request.method} ${request.url} → ${envelope.statusCode} ${envelope.code}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(envelope.statusCode).json(envelope);
  }
}

export interface ErrorEnvelope {
  code: string;
  message: string;
  requestId: string;
  statusCode: number;
  fieldErrors?: Array<{ field: string; message: string }>;
}

function readRequestId(request: Request): string {
  const header = request.headers['x-request-id'];
  return typeof header === 'string' && header.length > 0 ? header : randomUUID();
}

function mapException(exception: unknown, requestId: string): ErrorEnvelope {
  if (exception instanceof ZodError) {
    return {
      code: 'VALIDATION_ERROR',
      message: 'İstek doğrulamadan geçemedi',
      requestId,
      statusCode: HttpStatus.BAD_REQUEST,
      fieldErrors: exception.issues.map((issue) => ({
        field: issue.path.join('.') || '(kök)',
        message: issue.message,
      })),
    };
  }

  if (exception instanceof HttpException) {
    const statusCode = exception.getStatus();
    const body = exception.getResponse();
    const message = extractMessage(body);
    const fieldErrors = extractFieldErrors(body);
    return {
      code: codeForStatus(statusCode),
      message,
      requestId,
      statusCode,
      ...(fieldErrors ? { fieldErrors } : {}),
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: 'Beklenmeyen bir hata oluştu',
    requestId,
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
  };
}

function extractMessage(body: string | object): string {
  if (typeof body === 'string') {
    return body;
  }
  if ('message' in body) {
    const message = body.message;
    if (typeof message === 'string') {
      return message;
    }
    if (Array.isArray(message)) {
      return 'İstek doğrulamadan geçemedi';
    }
  }
  return 'İstek reddedildi';
}

function extractFieldErrors(
  body: string | object,
): Array<{ field: string; message: string }> | undefined {
  if (typeof body === 'object' && 'message' in body && Array.isArray(body.message)) {
    const messages = body.message as unknown[];
    if (messages.every((m) => typeof m === 'string')) {
      // Nest'in ValidationPipe dizisi alan bilgisi taşımaz; genel alan adı kullan.
      return messages.map((m) => ({ field: '(girdi)', message: String(m) }));
    }
  }
  return undefined;
}

function codeForStatus(statusCode: number): string {
  switch (statusCode) {
    case HttpStatus.BAD_REQUEST:
      return 'VALIDATION_ERROR';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'UNPROCESSABLE_ENTITY';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'SERVICE_UNAVAILABLE';
    default:
      return `HTTP_${statusCode}`;
  }
}
