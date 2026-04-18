import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SurgeryRequestTussItem } from '../entities/surgery-request-tuss-item.entity';
import { BaseRepository } from './base.repository';

@Global()
@Injectable()
export class SurgeryRequestTussItemRepository extends BaseRepository<SurgeryRequestTussItem> {
  constructor(
    @InjectRepository(SurgeryRequestTussItem)
    repository: Repository<SurgeryRequestTussItem>,
  ) {
    super(repository);
  }
}
