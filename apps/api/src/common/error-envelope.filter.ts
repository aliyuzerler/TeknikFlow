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
    // Faz 03: istisna gövdesinde kod taşınıyorsa (INVALID_CREDENTIALS,
    // CSRF_INVALID, PLAN_LIMIT_EXCEEDED...) duruma göre türetilmiş genel kod
    // yerine o kod kullanılır — istemciler ayrım yapabilir.
    const code = extractCode(body) ?? codeForStatus(statusCode);
    // Faz 04: güvenli ek bağlam alanları (çakışan kaydın KENDİ kiracısındaki
    // kimliği vb.) — yalnız beyin listedeki anahtarlar taşınır.
    const details = extractSafeDetails(body);
    return {
      code,
      message,
      requestId,
      statusCode,
      ...(fieldErrors ? { fieldErrors } : {}),
      ...(details ? { details } : {}),
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

/**
 * İstisna gövdesinden güvenli ek alanlar (varsa) — beyin liste dışı asla geçmez.
 * Varlık sızıntısı yaratmaz: bu alanlar yalnız kendi kiracısındaki kayıtları
 * refere eder (RLS zaten kiracı dışını 404'ler).
 */
function extractSafeDetails(body: string | object): Record<string, string | number> | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const allowed = ['customerId', 'assetId', 'invitationId', 'assetCount', 'limit'];
  const details: Record<string, string | number> = {};
  for (const key of allowed) {
    if (key in body) {
      const value = (body as Record<string, unknown>)[key];
      if (typeof value === 'string' || typeof value === 'number') {
        details[key] = value;
      }
    }
  }
  return Object.keys(details).length > 0 ? details : undefined;
}

/** İstisna gövdesindeki açık kod (varsa) — genel kod yerine geçer. */
function extractCode(body: string | object): string | undefined {
  if (typeof body === 'object' && 'code' in body) {
    const code = (body as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,60}$/.test(code)) {
      return code;
    }
  }
  return undefined;
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
