import { ApiProperty } from '@nestjs/swagger';
import { AdminActionReasonDto } from '../../subscriptions/dto/admin-subscription-actions.dto';

export class AccountStatusActionDto extends AdminActionReasonDto {}

export class AdminAccountStatusResultDto {
  @ApiProperty() auditLogId: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  accountDeactivatedAt: Date | null;
  @ApiProperty({
    description: 'Usuários da conta que tiveram as sessões encerradas',
  })
  revokedUsers: number;
}
