import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

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

  it('foto de paciente: mesma assinatura dentro da janela (TTL/2), válida por no máximo TTL', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-07T10:05:00.000Z') });
    await service.getSignedUrl('patient-photos/owner-a/foto.webp');
    jest.setSystemTime(new Date('2026-10-07T10:29:59.000Z'));
    await service.getSignedUrl('patient-photos/owner-a/foto.webp');

    const [primeira, segunda] = presign.mock.calls;
    expect(primeira[2]).toEqual({
      expiresIn: 3600,
      signingDate: new Date('2026-10-07T10:00:00.000Z'),
    });
    expect(segunda[2]).toEqual(primeira[2]);
    const comando = primeira[1] as GetObjectCommand;
    expect(comando.input.ResponseCacheControl).toBe('private, max-age=1800');
  });

  it('virando a janela (meia hora), a assinatura muda', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-07T10:30:01.000Z') });
    await service.getSignedUrl('patient-photos/owner-a/foto.webp');
    expect(presign.mock.calls[0][2].signingDate).toEqual(
      new Date('2026-10-07T10:30:00.000Z'),
    );
  });

  it('link entregue nunca vale menos que o max-age do cache nem mais que o TTL', async () => {
    // Pior caso: pedido no último segundo da janela.
    const agora = new Date('2026-10-07T10:29:59.000Z');
    jest.useFakeTimers({ now: agora });
    await service.getSignedUrl('patient-photos/owner-a/foto.webp');
    const { expiresIn, signingDate } = presign.mock.calls[0][2];
    const restante =
      (signingDate.getTime() + expiresIn * 1000 - agora.getTime()) / 1000;
    expect(restante).toBeGreaterThanOrEqual(1800);
    expect(expiresIn).toBeLessThanOrEqual(3600);
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
    expect(foto.CacheControl).toBe('private, max-age=1800');
    expect(doc.CacheControl).toBeUndefined();
  });

  describe('deleteMany', () => {
    it('devolve as chaves que o R2 recusou uma a uma', async () => {
      s3.send.mockResolvedValueOnce({
        Errors: [{ Key: 'patient-photos/o/b.png', Code: 'AccessDenied' }],
      });
      const falhas = await service.deleteMany([
        'patient-photos/o/a.png',
        'patient-photos/o/b.png',
      ]);
      expect(falhas).toEqual(['patient-photos/o/b.png']);
      expect(s3.send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectsCommand);
    });

    it('requisição inteira falhou: todas viram falha, sem lançar', async () => {
      s3.send.mockRejectedValueOnce(new Error('R2 fora'));
      await expect(service.deleteMany(['a', 'b'])).resolves.toEqual(['a', 'b']);
    });

    it('lista vazia não chama o R2', async () => {
      await expect(service.deleteMany([])).resolves.toEqual([]);
      expect(s3.send).not.toHaveBeenCalled();
    });
  });
  describe('listAll', () => {
    it('pagina pelo ContinuationToken até o fim (passa dos 1000 do listFolder)', async () => {
      const data = new Date('2026-10-01T00:00:00.000Z');
      s3.send
        .mockResolvedValueOnce({
          Contents: [{ Key: 'patient-photos/o/a.webp', LastModified: data }],
          IsTruncated: true,
          NextContinuationToken: 'tok-2',
        })
        .mockResolvedValueOnce({
          Contents: [{ Key: 'patient-photos/o/b.webp' }],
          IsTruncated: false,
        });

      const objetos = await service.listAll('patient-photos');

      expect(objetos).toEqual([
        { key: 'patient-photos/o/a.webp', lastModified: data },
        { key: 'patient-photos/o/b.webp', lastModified: null },
      ]);
      const [primeira, segunda] = s3.send.mock.calls.map(
        (c) => (c[0] as ListObjectsV2Command).input,
      );
      expect(primeira.Prefix).toBe('patient-photos/');
      expect(primeira.ContinuationToken).toBeUndefined();
      expect(segunda.ContinuationToken).toBe('tok-2');
    });

    it('falha na listagem lança (lista truncada em silêncio enganaria a varredura)', async () => {
      s3.send.mockRejectedValueOnce(new Error('R2 fora'));
      await expect(service.listAll('patient-photos')).rejects.toThrow(
        'R2 fora',
      );
    });
  });
});
