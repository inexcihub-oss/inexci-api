import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OpmeItem } from '../entities/opme-item.entity';

@Global()
@Injectable()
export class OpmeItemRepository {
  constructor(
    @InjectRepository(OpmeItem)
    private readonly repository: Repository<OpmeItem>,
  ) {}

  async create(data: Partial<OpmeItem>): Promise<OpmeItem> {
    const opmeItem = this.repository.create(data);
    return await this.repository.save(opmeItem);
  }

  async update(id: number, data: Partial<OpmeItem>): Promise<OpmeItem> {
    await this.repository.update(id, data);
    return await this.repository.findOne({ where: { id } });
  }
}
