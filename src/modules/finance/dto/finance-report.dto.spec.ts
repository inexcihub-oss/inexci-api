import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  OpenReportQueryDto,
  ReceiptsReportQueryDto,
} from './finance-report.dto';
import { AccountStatementQueryDto } from './account-statement.dto';

async function erros<T extends object>(
  classe: new () => T,
  dados: Record<string, unknown>,
): Promise<string[]> {
  const resultado = await validate(plainToInstance(classe, dados));
  return resultado.map((erro) => erro.property);
}

describe('DTOs dos relatórios financeiros', () => {
  const valido = { from: '2026-10-01', to: '2026-10-31', groupBy: 'day' };

  it('aceita período e agrupamento válidos', async () => {
    await expect(erros(ReceiptsReportQueryDto, valido)).resolves.toEqual([]);
    await expect(
      erros(ReceiptsReportQueryDto, { ...valido, format: 'csv' }),
    ).resolves.toEqual([]);
  });

  it.each([
    ['20/10/2026'],
    ['2026-10-1'],
    ['2026-02-30'],
    ['2026-10-01T00:00:00Z'],
    [''],
  ])('recusa a data %p', async (data) => {
    await expect(
      erros(ReceiptsReportQueryDto, { ...valido, from: data }),
    ).resolves.toContain('from');
  });

  it('exige from e to', async () => {
    const props = await erros(AccountStatementQueryDto, {});
    expect(props).toEqual(expect.arrayContaining(['from', 'to']));
  });

  it('recusa agrupamento e formato desconhecidos', async () => {
    await expect(
      erros(ReceiptsReportQueryDto, { ...valido, groupBy: 'week' }),
    ).resolves.toEqual(['groupBy']);
    await expect(
      erros(ReceiptsReportQueryDto, { ...valido, format: 'xlsx' }),
    ).resolves.toEqual(['format']);
  });

  it('until é opcional mas validado', async () => {
    await expect(erros(OpenReportQueryDto, {})).resolves.toEqual([]);
    await expect(
      erros(OpenReportQueryDto, { until: '2026-13-01' }),
    ).resolves.toEqual(['until']);
  });
});
