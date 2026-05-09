import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public } from 'src/shared/decorator/is-public.decorator';
import { SubscriptionPlanRepository } from 'src/database/repositories/subscription-plan.repository';

@ApiTags('Billing')
@Controller('billing/plans')
export class PlansController {
  constructor(private readonly planRepo: SubscriptionPlanRepository) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Listar planos de assinatura dispon\u00edveis' })
  @ApiResponse({ status: 200 })
  async list() {
    const plans = await this.planRepo.findPublicPlans();
    return plans.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      priceCents: p.priceCents,
      currency: p.currency,
      billingPeriod: p.billingPeriod,
      surgeryRequestQuota: p.surgeryRequestQuota,
      sortOrder: p.sortOrder,
    }));
  }
}
