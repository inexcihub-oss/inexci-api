import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  AuthenticatedUser,
  CurrentUser,
} from 'src/shared/decorators/current-user.decorator';
import { RequirePermission } from 'src/shared/decorators/require-permission.decorator';
import { SkipConsentCheck } from 'src/shared/decorators/skip-consent-check.decorator';
import { Permission } from 'src/shared/permissions';

import { QuotaService, QuotaStatus } from '../services/quota.service';

@ApiTags('Billing')
@ApiBearerAuth()
@Controller('billing/quota')
export class QuotaController {
  constructor(private readonly quotaService: QuotaService) {}

  @Get()
  @RequirePermission(Permission.SOLICITACOES)
  @SkipConsentCheck()
  @ApiOperation({
    summary: 'Cota de solicitações cirúrgicas do ciclo corrente',
  })
  async me(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuotaStatus | null> {
    const ownerId = user.ownerId ?? user.userId;
    return this.quotaService.getQuotaStatus(ownerId);
  }
}
