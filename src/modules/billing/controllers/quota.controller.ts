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

/**
 * Leitura da cota de solicitações da conta.
 *
 * Existe separado do `SubscriptionsController` por causa da audiência: lá tudo
 * passa por `assertOwner`, porque plano, fatura e cartão são do dono. A cota,
 * não — quem esbarra no limite é quem envia a solicitação. Sem esta rota, o
 * médico só descobriria o teto no modal de bloqueio, depois de preencher o
 * wizard inteiro.
 *
 * O escopo vem do `ownerId` do próprio JWT, então ninguém lê a cota de outra
 * conta, e o payload não carrega preço, status de pagamento nem gateway.
 */
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
