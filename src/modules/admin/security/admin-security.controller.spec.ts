import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AdminSecurityController } from './admin-security.controller';
import { AdminSecurityQueryDto } from './dto/admin-security.dto';

describe('AdminSecurityController', () => {
  const service = {
    overview: jest.fn().mockResolvedValue('overview'),
    forAccount: jest.fn().mockResolvedValue('conta'),
    logsForAccount: jest.fn().mockResolvedValue('logs'),
  };
  const controller = new AdminSecurityController(service as never);

  it('repassa período e conta para o serviço', async () => {
    await expect(controller.overview({ days: 7 })).resolves.toBe('overview');
    expect(service.overview).toHaveBeenCalledWith({ days: 7 });
    await expect(controller.forAccount('o1', { days: 1 })).resolves.toBe(
      'conta',
    );
    expect(service.forAccount).toHaveBeenCalledWith('o1', { days: 1 });
    await expect(controller.logs('o1', {})).resolves.toBe('logs');
    expect(service.logsForAccount).toHaveBeenCalledWith('o1', {});
  });

  it('só aceita os períodos 1, 7, 30 e 90 dias', async () => {
    const ok = plainToInstance(AdminSecurityQueryDto, { days: '30' });
    expect(await validate(ok)).toHaveLength(0);
    const ruim = plainToInstance(AdminSecurityQueryDto, { days: '45' });
    expect(await validate(ruim)).not.toHaveLength(0);
  });
});
