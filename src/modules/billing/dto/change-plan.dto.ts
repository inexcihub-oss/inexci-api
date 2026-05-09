import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ChangePlanDto {
  @ApiProperty({ description: 'ID do novo plano de assinatura' })
  @IsUUID()
  planId: string;
}
