import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SurgeryRequestActivity } from '../entities/surgery-request-activity.entity';
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
}
