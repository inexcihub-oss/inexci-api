import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';

const detectarTipo = (buf: Buffer) => {
  const hex = buf.subarray(0, 4).toString('hex');
  if (hex === '1a45dfa3')
    return Promise.resolve({ ext: 'webm', mime: 'video/webm' });
  if (buf.subarray(0, 4).toString() === '%PDF')
    return Promise.resolve({ ext: 'pdf', mime: 'application/pdf' });
  return Promise.resolve(undefined);
};
jest.mock('file-type', () => ({ fileTypeFromBuffer: detectarTipo }), {
  virtual: true,
});

import { ClinicalTranscriptionService } from './clinical-transcription.service';

const WEBM = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84]),
  Buffer.from('webm'),
  Buffer.alloc(64),
]);

function arquivo(buffer: Buffer, mimetype = 'audio/webm;codecs=opus') {
  return {
    buffer,
    mimetype,
    size: buffer.length,
    originalname: 'ditado.webm',
  } as Express.Multer.File;
}

describe('ClinicalTranscriptionService', () => {
  const transcription = {
    transcribe: jest.fn(),
    usesExternalProvider: jest.fn(),
  };
  const accessControl = { assertIsDoctor: jest.fn() };
  const config: Record<string, string> = {};
  const configService = {
    get: jest.fn((chave: string, padrao?: string) => config[chave] ?? padrao),
  };
  const service = new ClinicalTranscriptionService(
    transcription as never,
    accessControl as never,
    configService as never,
  );
  const medico = { userId: 'doc-1', aiConsentAcceptedAt: null };

  beforeEach(() => {
    jest.clearAllMocks();
    for (const chave of Object.keys(config)) delete config[chave];
    config.CLINICAL_DICTATION_ENABLED = 'true';
    accessControl.assertIsDoctor.mockResolvedValue(undefined);
    transcription.usesExternalProvider.mockReturnValue(false);
    transcription.transcribe.mockResolvedValue({
      text: 'Dor no joelho direito há três meses.',
      provider: 'faster_whisper',
      latencyMs: 900,
    });
  });

  it('transcreve o áudio do médico pelo serviço interno, sem guardar nada', async () => {
    await expect(service.transcribe(arquivo(WEBM), medico)).resolves.toEqual({
      text: 'Dor no joelho direito há três meses.',
    });
    expect(transcription.transcribe).toHaveBeenCalledWith({
      audioBuffer: WEBM,
      mimeType: 'audio/webm',
      fileName: 'ditado.webm',
      language: 'pt',
    });
  });

  it('fica desligado por padrão e responde 404 sem tocar no áudio', async () => {
    delete config.CLINICAL_DICTATION_ENABLED;
    await expect(
      service.transcribe(arquivo(WEBM), medico),
    ).rejects.toMatchObject({ status: 404 });
    expect(accessControl.assertIsDoctor).not.toHaveBeenCalled();
    expect(transcription.transcribe).not.toHaveBeenCalled();
  });

  it('é ato do médico', async () => {
    accessControl.assertIsDoctor.mockRejectedValue(new ForbiddenException());
    await expect(service.transcribe(arquivo(WEBM), medico)).rejects.toThrow(
      ForbiddenException,
    );
    expect(transcription.transcribe).not.toHaveBeenCalled();
  });

  it('exige consentimento de IA só quando o áudio pode ir para a OpenAI', async () => {
    transcription.usesExternalProvider.mockReturnValue(true);
    await expect(
      service.transcribe(arquivo(WEBM), medico),
    ).rejects.toMatchObject({
      response: { error: 'AI_CONSENT_REQUIRED' },
    });
    expect(transcription.transcribe).not.toHaveBeenCalled();

    await expect(
      service.transcribe(arquivo(WEBM), {
        userId: 'doc-1',
        aiConsentAcceptedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).resolves.toEqual({ text: 'Dor no joelho direito há três meses.' });
  });

  it('respeita o desligamento do áudio por configuração', async () => {
    config.AI_AUDIO_ENABLED = 'false';
    await expect(service.transcribe(arquivo(WEBM), medico)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('recusa requisição sem áudio', async () => {
    await expect(service.transcribe(undefined, medico)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('recusa arquivo que não é áudio, mesmo declarado como áudio', async () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64)]);
    await expect(
      service.transcribe(arquivo(pdf, 'audio/webm'), medico),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.transcribe(arquivo(WEBM, 'application/pdf'), medico),
    ).rejects.toThrow(BadRequestException);
    expect(transcription.transcribe).not.toHaveBeenCalled();
  });

  it('falha do serviço de transcrição vira 503 com mensagem para o médico', async () => {
    transcription.transcribe.mockRejectedValue(
      new Error('faster-whisper retornou status 422'),
    );
    await expect(
      service.transcribe(arquivo(WEBM), medico),
    ).rejects.toMatchObject({
      status: 503,
      message:
        'Não foi possível transcrever o áudio. Fale perto do microfone e tente de novo.',
    });
  });
});
