import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AdminAccountSort,
  ListAdminAccountsQueryDto,
} from './list-admin-accounts-query.dto';

async function errorsOf(query: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(ListAdminAccountsQueryDto, query);
  const errors = await validate(dto);
  return errors.map((e) => e.property);
}

describe('ListAdminAccountsQueryDto — saúde', () => {
  it.each(['healthy', 'attention', 'risk'])('aceita health=%s', async (h) => {
    await expect(errorsOf({ health: h })).resolves.toEqual([]);
  });

  it('recusa faixa desconhecida', async () => {
    await expect(errorsOf({ health: 'ruim' })).resolves.toEqual(['health']);
  });

  it('aceita ordenar por saúde', async () => {
    await expect(
      errorsOf({ sortBy: AdminAccountSort.HEALTH }),
    ).resolves.toEqual([]);
  });
});
