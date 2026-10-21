import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PaymentReceiptIssue } from '../entities/payment-receipt-issue.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class PaymentReceiptIssueRepository extends BaseRepository<PaymentReceiptIssue> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(PaymentReceiptIssue));
  }

  async register(
    dados: Pick<
      PaymentReceiptIssue,
      'ownerId' | 'paymentId' | 'issuedById' | 'withSignature'
    >,
  ): Promise<void> {
    await this.repository.insert(dados);
  }
}
