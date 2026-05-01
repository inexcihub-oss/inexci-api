import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OpmeItem } from '../entities/opme-item.entity';
import { BaseRepository } from './base.repository';

@Global()
@Injectable()
export class OpmeItemRepository extends BaseRepository<OpmeItem> {
  constructor(
    @InjectRepository(OpmeItem)
    repository: Repository<OpmeItem>,
  ) {
    super(repository);
  }

  findByIdWithSuppliers(id: string): Promise<OpmeItem | null> {
    return this.repository.findOne({
      where: { id },
      relations: ['suppliers'],
    });
  }

  saveWithSuppliers(opmeItem: OpmeItem): Promise<OpmeItem> {
    return this.repository.save(opmeItem);
  }
}
