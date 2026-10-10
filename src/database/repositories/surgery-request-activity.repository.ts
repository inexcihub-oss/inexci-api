import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import {
  ActivityType,
  SurgeryRequestActivity,
} from '../entities/surgery-request-activity.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class SurgeryRequestActivityRepository extends BaseRepository<SurgeryRequestActivity> {
  constructor(
    @InjectRepository(SurgeryRequestActivity)
    repository: Repository<SurgeryRequestActivity>,
  ) {
    super(repository);
  }

  async findBySurgeryRequest(
    surgeryRequestId: string,
  ): Promise<SurgeryRequestActivity[]> {
    return await this.repository.find({
      where: { surgeryRequestId },
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });
  }

  findByTypeSince(
    surgeryRequestId: string,
    type: ActivityType,
    since: Date,
  ): Promise<SurgeryRequestActivity[]> {
    return this.repository.find({
      where: { surgeryRequestId, type, createdAt: MoreThanOrEqual(since) },
      order: { createdAt: 'DESC' },
    });
  }
}
