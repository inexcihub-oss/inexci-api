import {
  ExecutionContext,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { JsonOnlyGuard } from './json-only.guard';

function contexto(
  method: string,
  headers: Record<string, string | undefined>,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ method, headers }) }),
  } as unknown as ExecutionContext;
}

describe('JsonOnlyGuard', () => {
  const guard = new JsonOnlyGuard();

  it('aceita application/json, inclusive com charset', () => {
    expect(
      guard.canActivate(
        contexto('POST', { 'content-type': 'application/json' }),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        contexto('POST', {
          'content-type': 'Application/JSON; charset=utf-8',
        }),
      ),
    ).toBe(true);
  });

  it('recusa formulário urlencoded (login CSRF por <form>) com 415', () => {
    expect(() =>
      guard.canActivate(
        contexto('POST', {
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': '30',
        }),
      ),
    ).toThrow(UnsupportedMediaTypeException);
  });

  it('recusa multipart e text/plain com 415', () => {
    expect(() =>
      guard.canActivate(
        contexto('POST', {
          'content-type': 'multipart/form-data; boundary=x',
        }),
      ),
    ).toThrow(UnsupportedMediaTypeException);
    expect(() =>
      guard.canActivate(contexto('PUT', { 'content-type': 'text/plain' })),
    ).toThrow(UnsupportedMediaTypeException);
  });

  it('aceita POST sem corpo e sem Content-Type (logout, reenvio de e-mail)', () => {
    expect(guard.canActivate(contexto('POST', {}))).toBe(true);
    expect(guard.canActivate(contexto('POST', { 'content-length': '0' }))).toBe(
      true,
    );
  });

  it('recusa corpo sem Content-Type', () => {
    expect(() =>
      guard.canActivate(contexto('POST', { 'content-length': '12' })),
    ).toThrow(UnsupportedMediaTypeException);
  });

  it('não interfere em GET', () => {
    expect(
      guard.canActivate(contexto('GET', { 'content-type': 'text/html' })),
    ).toBe(true);
  });
});
