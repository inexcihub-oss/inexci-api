import { ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';
import {
  getRequestContext,
  requestContextStorage,
} from './request-context';

function buildExecutionContext(req: any, res: any): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
    getClass: () => ({ name: 'FakeController' }) as any,
    getHandler: () => ({ name: 'fakeHandler' }) as any,
  } as unknown as ExecutionContext;
}

describe('LoggingInterceptor — propagação de userId/userEmail', () => {
  let interceptor: LoggingInterceptor;

  beforeEach(() => {
    interceptor = new LoggingInterceptor();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('popula userId a partir de req.user.userId (payload do JwtStrategy)', async () => {
    const req = {
      method: 'GET',
      originalUrl: '/me',
      url: '/me',
      ip: '127.0.0.1',
      user: {
        userId: 'user-uuid-123',
        ownerId: 'tenant-1',
      },
    };
    const res = { statusCode: 200 };
    const handler: CallHandler = { handle: () => of('ok') };
    const ctxStore = { requestId: 'req-1' as string };

    let captured: ReturnType<typeof getRequestContext> | undefined;
    await requestContextStorage.run(ctxStore, async () => {
      const obs = interceptor.intercept(
        buildExecutionContext(req, res),
        handler,
      );
      await lastValueFrom(obs);
      captured = getRequestContext();
    });

    expect(captured?.userId).toBe('user-uuid-123');
    expect(captured?.tenantId).toBe('tenant-1');
  });

  it('aceita req.user.id como fallback (compat com strategies que populam id)', async () => {
    const req = {
      method: 'GET',
      originalUrl: '/x',
      url: '/x',
      user: { id: 'legacy-id' },
    };
    const res = { statusCode: 200 };
    const handler: CallHandler = { handle: () => of('ok') };

    let captured: ReturnType<typeof getRequestContext> | undefined;
    await requestContextStorage.run({ requestId: 'req-2' }, async () => {
      await lastValueFrom(
        interceptor.intercept(buildExecutionContext(req, res), handler),
      );
      captured = getRequestContext();
    });

    expect(captured?.userId).toBe('legacy-id');
  });

  it('não enriquece o contexto quando a request é anônima (sem req.user)', async () => {
    const req = {
      method: 'GET',
      originalUrl: '/public',
      url: '/public',
    };
    const res = { statusCode: 200 };
    const handler: CallHandler = { handle: () => of('ok') };

    let captured: ReturnType<typeof getRequestContext> | undefined;
    await requestContextStorage.run({ requestId: 'req-3' }, async () => {
      await lastValueFrom(
        interceptor.intercept(buildExecutionContext(req, res), handler),
      );
      captured = getRequestContext();
    });

    expect(captured?.userId).toBeUndefined();
    expect(captured?.requestId).toBe('req-3');
  });

  it('emite payload http_request com userId e tenantId', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log');
    const req = {
      method: 'POST',
      originalUrl: '/auth/login',
      url: '/auth/login',
      ip: '10.0.0.1',
      user: {
        userId: 'u-1',
        ownerId: 'owner-1',
      },
    };
    const res = { statusCode: 200 };
    const handler: CallHandler = { handle: () => of({ ok: true }) };

    await requestContextStorage.run({ requestId: 'req-4' }, async () => {
      await lastValueFrom(
        interceptor.intercept(buildExecutionContext(req, res), handler),
      );
    });

    const httpCalls = logSpy.mock.calls.filter((call) =>
      String(call[0] ?? '').includes('http_request'),
    );
    expect(httpCalls.length).toBe(1);
    const payload = JSON.parse(httpCalls[0][0] as string);
    expect(payload).toMatchObject({
      event: 'http_request',
      method: 'POST',
      url: '/auth/login',
      statusCode: 200,
      userId: 'u-1',
      tenantId: 'owner-1',
    });
    expect(payload).not.toHaveProperty('userEmail');
  });

  it('em caso de erro, ainda emite o payload http_request', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error');
    const req = {
      method: 'GET',
      originalUrl: '/boom',
      url: '/boom',
      user: { userId: 'u-x' },
    };
    const res = { statusCode: 500 };
    const handler: CallHandler = {
      handle: () => throwError(() => new Error('explodiu')),
    };

    await requestContextStorage.run({ requestId: 'req-5' }, async () => {
      await expect(
        lastValueFrom(
          interceptor.intercept(buildExecutionContext(req, res), handler),
        ),
      ).rejects.toThrow('explodiu');
    });

    const httpErrorCalls = errorSpy.mock.calls.filter((call) =>
      String(call[0] ?? '').includes('http_request'),
    );
    expect(httpErrorCalls.length).toBe(1);
    const payload = JSON.parse(httpErrorCalls[0][0] as string);
    expect(payload.statusCode).toBe(500);
    expect(payload.userId).toBe('u-x');
  });
});
