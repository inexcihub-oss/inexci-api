import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Invoice } from '../entities/invoice.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class InvoiceRepository extends BaseRepository<Invoice> {
  constructor(@InjectRepository(Invoice) repo: Repository<Invoice>) {
    super(repo);
  }

  async findByOwnerId(
    ownerId: string,
    skip = 0,
    take = 50,
  ): Promise<{ records: Invoice[]; total: number }> {
    const [records, total] = await this.repository.findAndCount({
      where: { ownerId },
      order: { createdAt: 'DESC' },
      skip,
      take,
    });
    return { records, total };
  }

  async findByGatewayInvoiceId(
    gatewayInvoiceId: string,
  ): Promise<Invoice | null> {
    return this.repository.findOne({ where: { gatewayInvoiceId } });
  }
}
