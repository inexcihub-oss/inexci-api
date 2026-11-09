import { BadRequestException } from '@nestjs/common';
import { AdminErrorsController } from './admin-errors.controller';
import { FingerprintPipe } from './fingerprint.pipe';

describe('AdminErrorsController', () => {
  const service = {
    overview: jest.fn().mockResolvedValue('overview'),
    forAccount: jest.fn().mockResolvedValue('conta'),
    occurrences: jest.fn().mockResolvedValue('ocorrencias'),
  };
  const controller = new AdminErrorsController(service as never);

  it('repassa filtros para o serviço', async () => {
    await expect(controller.overview({ days: 7 })).resolves.toBe('overview');
    expect(service.overview).toHaveBeenCalledWith({ days: 7 });
    await expect(controller.forAccount('o1', { days: 1 })).resolves.toBe(
      'conta',
    );
    expect(service.forAccount).toHaveBeenCalledWith('o1', { days: 1 });
    const fp = 'b'.repeat(64);
    await expect(controller.occurrences(fp, { ownerId: 'o1' })).resolves.toBe(
      'ocorrencias',
    );
    expect(service.occurrences).toHaveBeenCalledWith(fp, { ownerId: 'o1' });
  });

  it('impressão inválida é recusada antes do serviço', () => {
    const pipe = new FingerprintPipe();
    expect(() => pipe.transform('abc')).toThrow(BadRequestException);
    expect(() => pipe.transform('G'.repeat(64))).toThrow(BadRequestException);
    expect(pipe.transform('c'.repeat(64))).toBe('c'.repeat(64));
  });
});
