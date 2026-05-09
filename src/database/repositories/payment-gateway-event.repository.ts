import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaymentGatewayEvent } from '../entities/payment-gateway-event.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class PaymentGatewayEventRepository extends BaseRepository<PaymentGatewayEvent> {
  constructor(
    @InjectRepository(PaymentGatewayEvent)
    repo: Repository<PaymentGatewayEvent>,
  ) {
    super(repo);
  }

  async findByProviderEvent(
    gatewayProvider: string,
    eventId: string,
  ): Promise<PaymentGatewayEvent | null> {
    return this.repository.findOne({
      where: { gatewayProvider, eventId },
    });
  }
}
