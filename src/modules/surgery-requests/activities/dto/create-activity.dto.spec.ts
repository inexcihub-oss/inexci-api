import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateActivityDto } from './create-activity.dto';
import { ActivityType } from 'src/database/entities/surgery-request-activity.entity';

async function erros(payload: Record<string, unknown>) {
  const dto = plainToInstance(CreateActivityDto, payload);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('CreateActivityDto', () => {
  it('aceita comentário sem tipo', async () => {
    expect(await erros({ content: 'oi' })).toHaveLength(0);
  });

  it('aceita o tipo comment enviado pelo frontend', async () => {
    expect(
      await erros({ content: 'oi', type: ActivityType.COMMENT }),
    ).toHaveLength(0);
  });

  it.each(
    Object.values(ActivityType).filter((t) => t !== ActivityType.COMMENT),
  )('recusa o tipo %s', async (tipo) => {
    const resultado = await erros({ content: 'oi', type: tipo });
    expect(resultado.map((e) => e.property)).toContain('type');
  });
});
