import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class OpenPortalDto {
  @ApiPropertyOptional({
    description:
      'Plano de destino. Quando informado, o portal abre direto na confirmação da troca para este plano.',
  })
  @IsOptional()
  @IsUUID()
  planId?: string;
}
