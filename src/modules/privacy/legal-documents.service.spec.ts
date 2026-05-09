import { NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { LegalDocumentsService } from './legal-documents.service';

describe('LegalDocumentsService', () => {
  let service: LegalDocumentsService;

  beforeEach(() => {
    service = new LegalDocumentsService();
    jest.restoreAllMocks();
  });

  it('lê o markdown atual quando o arquivo existe no primeiro candidato', async () => {
    const readSpy = jest
      .spyOn(fs, 'readFile')
      .mockResolvedValueOnce('# Política' as any);

    const doc = await service.getCurrent('privacy-policy');

    expect(doc.slug).toBe('privacy-policy');
    expect(doc.type).toBe('privacy_policy');
    expect(doc.content_md).toBe('# Política');
    expect(readSpy).toHaveBeenCalledTimes(1);
    const calledPath = readSpy.mock.calls[0][0] as string;
    expect(calledPath).toMatch(/privacy-policy\.md$/);
  });

  it('faz fallback para outros candidatos quando o primeiro não existe', async () => {
    const readSpy = jest
      .spyOn(fs, 'readFile')
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce('# Termos' as any);

    const doc = await service.getCurrent('terms-of-use');

    expect(doc.content_md).toBe('# Termos');
    expect(readSpy).toHaveBeenCalledTimes(2);
  });

  it('lança NotFoundException para slug desconhecido', async () => {
    await expect(service.getCurrent('inexistente')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lança NotFoundException quando nenhum candidato resolve o arquivo', async () => {
    jest.spyOn(fs, 'readFile').mockRejectedValue(new Error('ENOENT'));

    await expect(service.getCurrent('ai-disclosure')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lê integração real do arquivo presente em src/shared/legal', async () => {
    const real = new LegalDocumentsService();
    const doc = await real.getCurrent('privacy-policy');
    expect(doc.content_md.length).toBeGreaterThan(0);
  });
});
