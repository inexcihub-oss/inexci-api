import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Permission } from 'src/shared/permissions';
import {
  DATA_NO_FUTURO,
  DATA_RETROATIVA_DEMAIS,
  validarDataDoLancamento,
} from './data-do-lancamento';

describe('validarDataDoLancamento', () => {
  const agora = new Date('2026-10-20T15:00:00.000Z');
  const minutos = (n: number) => new Date(agora.getTime() + n * 60 * 1000);
  const dias = (n: number) =>
    new Date(agora.getTime() - n * 24 * 60 * 60 * 1000);

  it('aceita agora e até 5 minutos à frente', () => {
    expect(() => validarDataDoLancamento(agora, [], agora)).not.toThrow();
    expect(() => validarDataDoLancamento(minutos(5), [], agora)).not.toThrow();
  });

  it('recusa data mais de 5 minutos no futuro, mesmo para admin', () => {
    expect(() => validarDataDoLancamento(minutos(6), [], agora)).toThrow(
      BadRequestException,
    );
    expect(() =>
      validarDataDoLancamento(minutos(6), [Permission.ADMINISTRACAO], agora),
    ).toThrow(DATA_NO_FUTURO);
  });

  it('aceita até 7 dias atrás sem administração', () => {
    expect(() =>
      validarDataDoLancamento(dias(7), [Permission.FINANCEIRO], agora),
    ).not.toThrow();
  });

  it('acima de 7 dias exige administração', () => {
    expect(() =>
      validarDataDoLancamento(dias(8), [Permission.FINANCEIRO], agora),
    ).toThrow(ForbiddenException);
    expect(() => validarDataDoLancamento(dias(8), [], agora)).toThrow(
      DATA_RETROATIVA_DEMAIS,
    );
    expect(() =>
      validarDataDoLancamento(
        dias(30),
        [Permission.FINANCEIRO, Permission.ADMINISTRACAO],
        agora,
      ),
    ).not.toThrow();
  });
});
