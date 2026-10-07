import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const presign = jest.fn();
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => presign(...args),
}));

import { StorageService } from './storage.service';

describe('StorageService — cache das fotos de paciente', () => {
  const s3 = { send: jest.fn().mockResolvedValue({}) };
  const config = { get: () => 'bucket-teste' };
  const service = new StorageService(s3 as never, config as never);

  beforeEach(() => {
    jest.clearAllMocks();
    presign.mockResolvedValue('https://r2/assinada');
  });

  afterEach(() => jest.useRealTimers());

  it('foto de paciente: mesma assinatura dentro da janela, com Cache-Control', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-07T10:05:00.000Z') });
    await service.getSignedUrl('patient-photos/owner-a/foto.webp');
    jest.setSystemTime(new Date('2026-10-07T10:55:00.000Z'));
    await service.getSignedUrl('patient-photos/owner-a/foto.webp');

    const [primeira, segunda] = presign.mock.calls;
    expect(primeira[2]).toEqual({
      expiresIn: 7200,
      signingDate: new Date('2026-10-07T10:00:00.000Z'),
    });
    expect(segunda[2]).toEqual(primeira[2]);
    const comando = primeira[1] as GetObjectCommand;
    expect(comando.input.ResponseCacheControl).toBe('private, max-age=3600');
  });

  it('virando a janela, a assinatura muda', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-07T11:00:01.000Z') });
    await service.getSignedUrl('patient-photos/owner-a/foto.webp');
    expect(presign.mock.calls[0][2].signingDate).toEqual(
      new Date('2026-10-07T11:00:00.000Z'),
    );
  });

  it('documento clínico continua com link curto e sem cache', async () => {
    await service.getSignedUrl('documents/owner-a/laudo.pdf');
    expect(presign.mock.calls[0][2]).toEqual({ expiresIn: 900 });
    expect(
      (presign.mock.calls[0][1] as GetObjectCommand).input.ResponseCacheControl,
    ).toBeUndefined();
  });

  it('upload de foto de paciente grava Cache-Control; de documento, não', async () => {
    await service.uploadBuffer(
      Buffer.from('x'),
      'patient-photos',
      'f.webp',
      'image/webp',
      'owner-a',
    );
    await service.uploadBuffer(
      Buffer.from('x'),
      'documents',
      'l.pdf',
      'application/pdf',
      'owner-a',
    );
    const [foto, doc] = s3.send.mock.calls.map(
      (c) => (c[0] as PutObjectCommand).input,
    );
    expect(foto.CacheControl).toBe('private, max-age=3600');
    expect(doc.CacheControl).toBeUndefined();
  });
});
