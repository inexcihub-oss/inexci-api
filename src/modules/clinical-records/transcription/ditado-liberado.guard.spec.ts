import {
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DitadoLiberadoGuard, UsuarioDoDitado } from './ditado-liberado.guard';

describe('DitadoLiberadoGuard', () => {
  const config: Record<string, string> = {};
  const configService = {
    get: jest.fn((chave: string, padrao?: string) => config[chave] ?? padrao),
  };
  const accessControl = { assertIsDoctor: jest.fn() };
  const transcription = { usesExternalProvider: jest.fn() };
  const guard = new DitadoLiberadoGuard(
    configService as never,
    accessControl as never,
    transcription as never,
  );

  const contexto = (user?: UsuarioDoDitado) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  const medico = { userId: 'doc-1', aiConsentAcceptedAt: null };

  beforeEach(() => {
    jest.clearAllMocks();
    for (const chave of Object.keys(config)) delete config[chave];
    config.CLINICAL_DICTATION_ENABLED = 'true';
    accessControl.assertIsDoctor.mockResolvedValue(undefined);
    transcription.usesExternalProvider.mockReturnValue(false);
  });

  it('libera o médico com o ditado ligado', async () => {
    await expect(guard.canActivate(contexto(medico))).resolves.toBe(true);
    expect(accessControl.assertIsDoctor).toHaveBeenCalledWith('doc-1');
  });

  it('fica desligado por padrão e responde 404 sem consultar o usuário', async () => {
    delete config.CLINICAL_DICTATION_ENABLED;
    await expect(guard.canActivate(contexto(medico))).rejects.toMatchObject({
      status: 404,
    });
    expect(accessControl.assertIsDoctor).not.toHaveBeenCalled();
  });

  it('é ato do médico', async () => {
    accessControl.assertIsDoctor.mockRejectedValue(new ForbiddenException());
    await expect(guard.canActivate(contexto(medico))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('recusa requisição sem usuário', async () => {
    await expect(guard.canActivate(contexto())).rejects.toThrow(
      ForbiddenException,
    );
    expect(accessControl.assertIsDoctor).not.toHaveBeenCalled();
  });

  it('respeita o desligamento do áudio por configuração', async () => {
    config.AI_AUDIO_ENABLED = 'false';
    await expect(guard.canActivate(contexto(medico))).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('exige consentimento de IA só quando o áudio pode ir para a OpenAI', async () => {
    transcription.usesExternalProvider.mockReturnValue(true);
    await expect(guard.canActivate(contexto(medico))).rejects.toMatchObject({
      response: { error: 'AI_CONSENT_REQUIRED' },
    });
    await expect(
      guard.canActivate(
        contexto({
          userId: 'doc-1',
          aiConsentAcceptedAt: '2026-01-01T00:00:00.000Z',
        }),
      ),
    ).resolves.toBe(true);
  });
});
