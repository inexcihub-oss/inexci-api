import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AiEfficiencyQueryDto } from './dto/ai-efficiency-query.dto';
import {
  NotificationLogsQueryDto,
  NotificationLogsStatsQueryDto,
} from './envios/dto/notification-logs.dto';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

function validar<T>(type: new () => T, value: object): Promise<unknown> {
  return pipe.transform(value, { type: 'query', metatype: type });
}

describe('validação das queries do admin com o ValidationPipe global', () => {
  it('ai-efficiency aceita from e to e recusa propriedade desconhecida', async () => {
    await expect(
      validar(AiEfficiencyQueryDto, {
        from: '2026-10-01T03:00:00.000Z',
        to: '2026-11-01T03:00:00.000Z',
      }),
    ).resolves.toBeDefined();
    await expect(
      validar(AiEfficiencyQueryDto, { from: 'ontem' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validar(AiEfficiencyQueryDto, { x: '1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('notification-logs recusa UUID parcial, enum inválido e limite acima de 200', async () => {
    await expect(
      validar(NotificationLogsQueryDto, { ownerId: '1111-22' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validar(NotificationLogsQueryDto, { channel: 'sms' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validar(NotificationLogsQueryDto, { limit: '500' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('notification-logs converte números e datas', async () => {
    const out = (await validar(NotificationLogsQueryDto, {
      channel: 'email',
      status: 'failed',
      ownerId: '11111111-1111-4111-8111-111111111111',
      from: '2026-10-01T03:00:00.000Z',
      limit: '25',
      offset: '50',
    })) as NotificationLogsQueryDto;
    expect(out.limit).toBe(25);
    expect(out.offset).toBe(50);
    expect(out.from).toBeInstanceOf(Date);
  });

  it('stats não aceita status nem paginação', async () => {
    await expect(
      validar(NotificationLogsStatsQueryDto, { status: 'sent' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
