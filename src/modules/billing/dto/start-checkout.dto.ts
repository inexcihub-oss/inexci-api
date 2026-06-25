import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class StartCheckoutDto {
  @ApiProperty({ description: 'ID do plano de assinatura escolhido' })
  @IsUUID()
  planId: string;
}
