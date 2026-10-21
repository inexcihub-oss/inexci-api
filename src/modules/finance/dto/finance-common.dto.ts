import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDecimal,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export const VALOR_MONETARIO_REGEX = /^\d{1,10}(\.\d{1,2})?$/;
export const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const MENSAGEM_VALOR_MONETARIO =
  'Valor inválido. Use o formato 123.45, com até duas casas decimais';
export const MENSAGEM_DATA = 'Data inválida. Use o formato AAAA-MM-DD';
export const LIMITE_MAXIMO_POR_PAGINA = 100;

export function IsValorMonetario(): PropertyDecorator {
  return applyDecorators(
    IsString({ message: MENSAGEM_VALOR_MONETARIO }),
    IsDecimal({ decimal_digits: '0,2' }, { message: MENSAGEM_VALOR_MONETARIO }),
    Matches(VALOR_MONETARIO_REGEX, { message: MENSAGEM_VALOR_MONETARIO }),
  );
}

export function IsDataCalendario(): PropertyDecorator {
  return applyDecorators(
    IsString({ message: MENSAGEM_DATA }),
    Matches(DATA_REGEX, { message: MENSAGEM_DATA }),
    IsISO8601({ strict: true }, { message: MENSAGEM_DATA }),
  );
}

export class ReferenciaDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

export class PaginacaoDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    default: 20,
    minimum: 1,
    maximum: LIMITE_MAXIMO_POR_PAGINA,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LIMITE_MAXIMO_POR_PAGINA)
  limit?: number = 20;
}

export function paginacao(dto: PaginacaoDto): {
  page: number;
  limit: number;
  skip: number;
} {
  const page = dto.page ?? 1;
  const limit = dto.limit ?? 20;
  return { page, limit, skip: (page - 1) * limit };
}
