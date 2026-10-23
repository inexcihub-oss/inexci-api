import { BadRequestException } from '@nestjs/common';

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
  const transcription = { transcribe: jest.fn() };
  const config: Record<string, string> = {};
  const configService = {
    get: jest.fn((chave: string, padrao?: string) => config[chave] ?? padrao),
  };
  const service = new ClinicalTranscriptionService(
    transcription as never,
    configService as never,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    for (const chave of Object.keys(config)) delete config[chave];
    transcription.transcribe.mockResolvedValue({
      text: 'Dor no joelho direito há três meses.',
      provider: 'faster_whisper',
      latencyMs: 900,
    });
  });

  it('transcreve o áudio sem guardar nada', async () => {
    await expect(service.transcribe(arquivo(WEBM))).resolves.toEqual({
      text: 'Dor no joelho direito há três meses.',
    });
    expect(transcription.transcribe).toHaveBeenCalledWith({
      audioBuffer: WEBM,
      mimeType: 'audio/webm',
      fileName: 'ditado.webm',
      language: 'pt',
    });
  });

  it('respeita o limite de tamanho configurado em AI_AUDIO_MAX_BYTES', async () => {
    config.AI_AUDIO_MAX_BYTES = String(WEBM.length - 1);
    await expect(service.transcribe(arquivo(WEBM))).rejects.toMatchObject({
      status: 413,
    });
    expect(transcription.transcribe).not.toHaveBeenCalled();
  });

  it('nunca passa do teto do upload, mesmo com limite configurado maior', async () => {
    config.AI_AUDIO_MAX_BYTES = String(100 * 1024 * 1024);
    const grande = { ...arquivo(WEBM), size: 16 * 1024 * 1024 };
    await expect(service.transcribe(grande)).rejects.toMatchObject({
      status: 413,
    });
  });

  it('recusa requisição sem áudio', async () => {
    await expect(service.transcribe(undefined)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('recusa arquivo que não é áudio, mesmo declarado como áudio', async () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64)]);
    await expect(
      service.transcribe(arquivo(pdf, 'audio/webm')),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.transcribe(arquivo(WEBM, 'application/pdf')),
    ).rejects.toThrow(BadRequestException);
    expect(transcription.transcribe).not.toHaveBeenCalled();
  });

  it('falha do serviço de transcrição vira 503 com mensagem para o médico', async () => {
    transcription.transcribe.mockRejectedValue(
      new Error('faster-whisper retornou status 422'),
    );
    await expect(service.transcribe(arquivo(WEBM))).rejects.toMatchObject({
      status: 503,
      message:
        'Não foi possível transcrever o áudio. Fale perto do microfone e tente de novo.',
    });
  });
});
