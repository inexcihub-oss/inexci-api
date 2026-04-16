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
}
