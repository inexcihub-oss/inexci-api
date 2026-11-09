import { requestContextStorage } from 'src/shared/logging/request-context';
import { PlatformErrorRecorder } from './platform-error-recorder.service';
import {
  registerPlatformErrorSink,
  reportPlatformError,
} from './platform-error-sink';

describe('PlatformErrorRecorder', () => {
  const repository = { increment: jest.fn() };
  let recorder: PlatformErrorRecorder;

  beforeEach(() => {
    repository.increment.mockReset().mockResolvedValue(undefined);
    recorder = new PlatformErrorRecorder(repository as never);
  });

  afterEach(() => registerPlatformErrorSink(null));

  it('monta o registro com conta, usuário e requestId do contexto, dia de São Paulo', () => {
    const record = requestContextStorage.run(
      { requestId: 'req-9', tenantId: 'owner-1', userId: 'user-1' },
      () =>
        recorder.buildRecord(
          { source: 'http', route: 'GET /x/42', error: new Error('boom') },
          new Date('2026-10-28T02:00:00Z'),
        ),
    );
    expect(record).toMatchObject({
      ownerId: 'owner-1',
      userId: 'user-1',
      requestId: 'req-9',
      day: '2026-10-27',
      source: 'http',
      route: 'GET /x/:n',
      errorClass: 'Error',
      message: 'boom',
    });
  });

  it('dados explícitos do evento vencem o contexto (jobs)', () => {
    const record = recorder.buildRecord({
      source: 'queue',
      route: 'pdf-generation',
      error: new Error('x'),
      ownerId: 'owner-2',
      userId: 'user-2',
      requestId: 'req-2',
    });
    expect(record).toMatchObject({
      ownerId: 'owner-2',
      userId: 'user-2',
      requestId: 'req-2',
    });
  });

  it('sem sink registrado, reportar não faz nada', () => {
    expect(() =>
      reportPlatformError({ source: 'ai', route: null, error: 'x' }),
    ).not.toThrow();
    expect(repository.increment).not.toHaveBeenCalled();
  });

  it('registrado no init, o report grava com o contexto do momento do erro', async () => {
    recorder.onModuleInit();
    requestContextStorage.run({ requestId: 'r', tenantId: 'o-ctx' }, () =>
      reportPlatformError({ source: 'http', route: 'GET /a', error: 'x' }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(repository.increment).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'o-ctx', source: 'http' }),
    );
  });

  it('falha ao gravar nunca propaga', async () => {
    repository.increment.mockRejectedValue(new Error('db fora'));
    await expect(
      recorder.record({ source: 'http', route: null, error: 'x' }),
    ).resolves.toBeUndefined();
  });

  it('sink que lança é engolido pelo report', () => {
    registerPlatformErrorSink(() => {
      throw new Error('sink quebrado');
    });
    expect(() =>
      reportPlatformError({ source: 'http', route: null, error: 'x' }),
    ).not.toThrow();
  });

  it('onModuleDestroy desliga o sink', async () => {
    recorder.onModuleInit();
    recorder.onModuleDestroy();
    reportPlatformError({ source: 'http', route: null, error: 'x' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(repository.increment).not.toHaveBeenCalled();
  });
});
