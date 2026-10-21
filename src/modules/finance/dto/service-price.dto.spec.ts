import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateServicePriceDto,
  UpdateServicePriceDto,
} from './service-price.dto';

describe('DTOs da tabela de preços', () => {
  const erros = (dto: object) => validateSync(dto).map((e) => e.property);
  const criar = (payload: Record<string, unknown>) =>
    plainToInstance(CreateServicePriceDto, {
      description: 'Consulta',
      amount: '300.00',
      ...payload,
    });

  it('aceita o mínimo (descrição e valor) e valor zero', () => {
    expect(erros(criar({}))).toEqual([]);
    expect(erros(criar({ amount: '0' }))).toEqual([]);
  });

  it.each(['-1.00', '1.234', 'abc', '', '12345678901.00'])(
    'recusa o valor %p',
    (amount) => {
      expect(erros(criar({ amount }))).toContain('amount');
    },
  );

  it('recusa valor numérico (precisa ser string decimal)', () => {
    expect(erros(criar({ amount: 300 }))).toContain('amount');
  });

  it('recusa descrição só com espaços e tipo desconhecido', () => {
    expect(erros(criar({ description: '   ' }))).toContain('description');
    expect(erros(criar({ appointmentType: 'cirurgia' }))).toContain(
      'appointmentType',
    );
  });

  it('aceita médico e tipo nulos (vale para todos)', () => {
    expect(erros(criar({ doctorId: null, appointmentType: null }))).toEqual([]);
  });

  it('edição aceita corpo vazio e recusa valor inválido', () => {
    expect(erros(plainToInstance(UpdateServicePriceDto, {}))).toEqual([]);
    expect(
      erros(plainToInstance(UpdateServicePriceDto, { amount: '-5' })),
    ).toContain('amount');
    expect(
      erros(plainToInstance(UpdateServicePriceDto, { amount: null })),
    ).toContain('amount');
  });
});
