import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PdfService } from './pdf.service';

describe('PdfService — segurança SSRF (VULN-01)', () => {
  let service: PdfService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PdfService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<PdfService>(PdfService);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  it('deve retornar null para URL de metadados AWS (SSRF)', async () => {
    const url =
      'http://169.254.169.254/latest/meta-data/iam/security-credentials/';

    const result = await (service as any).fetchAsDataUri(url);
    expect(result).toBeNull();
  });

  it('deve retornar null para URL com protocolo http', async () => {
    const result = await (service as any).fetchAsDataUri(
      'http://accountid.r2.cloudflarestorage.com/bucket/file.png',
    );
    expect(result).toBeNull();
  });

  it('deve retornar null para localhost', async () => {
    const result = await (service as any).fetchAsDataUri(
      'https://localhost/secret',
    );
    expect(result).toBeNull();
  });

  it('deve retornar null para host interno Redis', async () => {
    const result = await (service as any).fetchAsDataUri('http://redis:6379/');
    expect(result).toBeNull();
  });
});
