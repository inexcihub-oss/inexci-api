import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Contestation,
  ContestationTypeEnum,
} from '../entities/contestation.entity';
import { BaseRepository } from './base.repository';

@Global()
@Injectable()
export class ContestationRepository extends BaseRepository<Contestation> {
  constructor(
    @InjectRepository(Contestation)
    repository: Repository<Contestation>,
  ) {
    super(repository);
  }

  findLatestBySurgeryRequest(
    surgeryRequestId: string,
    type: ContestationTypeEnum,
  ): Promise<Contestation | null> {
    return this.repository.findOne({
      where: { surgeryRequestId, type },
      order: { createdAt: 'DESC' },
    });
  }
}
