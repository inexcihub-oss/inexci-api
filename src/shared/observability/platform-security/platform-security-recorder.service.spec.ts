import { requestContextStorage } from 'src/shared/logging/request-context';
import { PlatformSecurityRecorder } from './platform-security-recorder.service';
import { reportSecurityEvent } from './platform-security-sink';

describe('PlatformSecurityRecorder', () => {
  function build() {
    const repository = {
      increment: jest.fn().mockResolvedValue(undefined),
      identityById: jest
        .fn()
        .mockResolvedValue({ userId: 'u1', ownerId: 'o1' }),
      identityByEmail: jest.fn().mockResolvedValue(null),
    };
    const recorder = new PlatformSecurityRecorder(repository as never);
    return { recorder, repository };
  }

  const now = new Date('2026-10-28T02:30:00Z');

  it('usa usuário e conta informados sem consultar o banco', async () => {
    const { recorder, repository } = build();
    const record = await recorder.buildRecord(
      { type: 'login_failed', userId: 'u9', ownerId: 'o9' },
      'req-1',
      now,
    );
    expect(repository.identityById).not.toHaveBeenCalled();
    expect(record).toEqual({
      ownerId: 'o9',
      userId: 'u9',
      day: '2026-10-27',
      eventType: 'login_failed',
      occurredAt: now,
      requestId: 'req-1',
    });
  });

  it('resolve a conta pelo usuário quando só ele é informado', async () => {
    const { recorder } = build();
    const record = await recorder.buildRecord(
      { type: 'refresh_reuse', userId: 'u1' },
      null,
      now,
    );
    expect(record).toMatchObject({ ownerId: 'o1', userId: 'u1' });
  });

  it('bloqueio de login: resolve pelo e-mail e nunca grava o e-mail digitado', async () => {
    const { recorder, repository } = build();
    repository.identityByEmail.mockResolvedValue({
      userId: 'u2',
      ownerId: 'o2',
    });
    await recorder.record(
      { type: 'login_locked', email: 'alvo@clinica.com' },
      'req-2',
    );
    expect(repository.identityByEmail).toHaveBeenCalledWith('alvo@clinica.com');
    const [gravado] = repository.increment.mock.calls[0];
    expect(JSON.stringify(gravado)).not.toContain('alvo@clinica.com');
    expect(gravado).toMatchObject({ ownerId: 'o2', userId: 'u2' });
  });

  it('bloqueio de e-mail que não é de ninguém conta só na plataforma, sem identificação', async () => {
    const { recorder, repository } = build();
    await recorder.record({ type: 'login_locked', email: 'x@y.com' });
    const [gravado] = repository.increment.mock.calls[0];
    expect(gravado).toMatchObject({ ownerId: null, userId: null });
    expect(JSON.stringify(gravado)).not.toContain('x@y.com');
  });

  it('evento sem identidade resolvível e que não é bloqueio não é gravado', async () => {
    const { recorder, repository } = build();
    await recorder.record({ type: 'login_failed', email: 'x@y.com' });
    expect(repository.increment).not.toHaveBeenCalled();
  });

  it('falha ao gravar não propaga', async () => {
    const { recorder, repository } = build();
    repository.increment.mockRejectedValue(new Error('db fora'));
    await expect(
      recorder.record({ type: 'mfa_failed', userId: 'u1' }),
    ).resolves.toBeUndefined();
  });

  it('o sink registrado não espera a gravação e leva o requestId do contexto', async () => {
    const { recorder, repository } = build();
    let liberar: () => void = () => {};
    repository.increment.mockReturnValue(
      new Promise<void>((resolve) => {
        liberar = resolve;
      }),
    );
    recorder.onModuleInit();
    requestContextStorage.run({ requestId: 'req-ctx' }, () => {
      expect(
        reportSecurityEvent({
          type: 'mfa_enabled',
          userId: 'u1',
          ownerId: 'o1',
        }),
      ).toBeUndefined();
    });
    await new Promise((r) => setImmediate(r));
    expect(repository.increment).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-ctx',
        eventType: 'mfa_enabled',
      }),
    );
    liberar();
    recorder.onModuleDestroy();
    reportSecurityEvent({ type: 'mfa_enabled', userId: 'u1' });
    expect(repository.increment).toHaveBeenCalledTimes(1);
  });
});
