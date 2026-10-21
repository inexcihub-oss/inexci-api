import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Permission } from 'src/shared/permissions';

export const TOLERANCIA_DE_FUTURO_MS = 5 * 60 * 1000;
export const RETROATIVIDADE_MAXIMA_DIAS = 7;

export const DATA_NO_FUTURO = 'A data não pode estar no futuro';
export const DATA_RETROATIVA_DEMAIS = `Datas com mais de ${RETROATIVIDADE_MAXIMA_DIAS} dias atrás só podem ser lançadas por quem tem a área Administração`;

export function validarDataDoLancamento(
  data: Date,
  permissoes: readonly Permission[],
  agora: Date = new Date(),
): void {
  if (data.getTime() > agora.getTime() + TOLERANCIA_DE_FUTURO_MS) {
    throw new BadRequestException(DATA_NO_FUTURO);
  }
  const limite =
    agora.getTime() - RETROATIVIDADE_MAXIMA_DIAS * 24 * 60 * 60 * 1000;
  if (
    data.getTime() < limite &&
    !permissoes.includes(Permission.ADMINISTRACAO)
  ) {
    throw new ForbiddenException(DATA_RETROATIVA_DEMAIS);
  }
}
