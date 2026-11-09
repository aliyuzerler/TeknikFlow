import { describe, expect, it, vi } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ZodError } from 'zod';
import { ErrorEnvelopeFilter } from './error-envelope.filter.js';
import type { Request, Response } from 'express';

function createHost(headers: Record<string, string | string[]> = {}) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const response = { status, json } as unknown as Response;
  const request = { headers, method: 'GET', url: '/test' } as unknown as Request;
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  } as unknown as ArgumentsHost;
  return { host, status, json, response };
}

describe('ErrorEnvelopeFilter', () => {
  const filter = new ErrorEnvelopeFilter();

  it('HttpException → durum koduna karşılık gelen kod zarfı', () => {
    const { host, status, json } = createHost({ 'x-request-id': 'req-123' });
    filter.catch(new HttpException('Kaynak bulunamadı', HttpStatus.NOT_FOUND), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'NOT_FOUND',
        message: 'Kaynak bulunamadı',
        requestId: 'req-123',
        statusCode: 404,
      }),
    );
  });

  it('ValidationPipe tarzı mesaj dizisi → fieldErrors', () => {
    const { host, json } = createHost({});
    const exception = new HttpException(
      {
        statusCode: 400,
        message: ['email must be an email', 'name should not be empty'],
        error: 'Bad Request',
      },
      HttpStatus.BAD_REQUEST,
    );
    filter.catch(exception, host);
    const envelope = json.mock.calls[0]![0] as Record<string, unknown>;
    expect(envelope['code']).toBe('VALIDATION_ERROR');
    expect(envelope['fieldErrors']).toEqual([
      { field: '(girdi)', message: 'email must be an email' },
      { field: '(girdi)', message: 'name should not be empty' },
    ]);
    expect(typeof envelope['requestId']).toBe('string');
  });

  it('ZodError → 400 VALIDATION_ERROR + alan detayları', () => {
    const { host, status, json } = createHost({});
    const zodError = new ZodError([
      { path: ['body', 'email'], message: 'Geçersiz e-posta', code: 'custom' },
    ]);
    filter.catch(zodError, host);
    expect(status).toHaveBeenCalledWith(400);
    const envelope = json.mock.calls[0]![0] as Record<string, unknown>;
    expect(envelope['fieldErrors']).toEqual([{ field: 'body.email', message: 'Geçersiz e-posta' }]);
  });

  it('bilinmeyen hata → 500 ve orijinal mesaj sızdırmaz', () => {
    const { host, status, json } = createHost({});
    filter.catch(new Error('secret token xyz'), host);
    expect(status).toHaveBeenCalledWith(500);
    const envelope = json.mock.calls[0]![0] as Record<string, unknown>;
    expect(envelope['code']).toBe('INTERNAL_ERROR');
    expect(envelope['message']).toBe('Beklenmeyen bir hata oluştu');
    expect(JSON.stringify(envelope)).not.toContain('secret token');
  });

  it('requestId yoksa üretilir', () => {
    const { host, json } = createHost({});
    filter.catch(new HttpException('x', HttpStatus.CONFLICT), host);
    const envelope = json.mock.calls[0]![0] as Record<string, unknown>;
    expect(typeof envelope['requestId']).toBe('string');
    expect(envelope['requestId']).not.toBe('');
  });
});
