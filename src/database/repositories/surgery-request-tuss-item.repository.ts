import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SurgeryRequestTussItem } from '../entities/surgery-request-tuss-item.entity';

@Global()
@Injectable()
export class SurgeryRequestTussItemRepository {
  constructor(
    @InjectRepository(SurgeryRequestTussItem)
    private readonly repository: Repository<SurgeryRequestTussItem>,
  ) {}

  async create(
    data: Partial<SurgeryRequestTussItem>,
  ): Promise<SurgeryRequestTussItem> {
    const item = this.repository.create(data);
    return this.repository.save(item);
  }

  async findOne(
    where: Partial<SurgeryRequestTussItem>,
  ): Promise<SurgeryRequestTussItem | null> {
    return this.repository.findOne({ where });
  }

  async update(
    id: string,
    data: Partial<SurgeryRequestTussItem>,
  ): Promise<SurgeryRequestTussItem> {
    await this.repository.update(id, data);
    return this.repository.findOne({ where: { id } });
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
