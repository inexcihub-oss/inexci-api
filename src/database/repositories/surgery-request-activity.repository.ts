import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SurgeryRequestActivity } from '../entities/surgery-request-activity.entity';

@Injectable()
export class SurgeryRequestActivityRepository {
  constructor(
    @InjectRepository(SurgeryRequestActivity)
    private readonly repository: Repository<SurgeryRequestActivity>,
  ) {}

  async create(
    data: Partial<SurgeryRequestActivity>,
  ): Promise<SurgeryRequestActivity> {
    const activity = this.repository.create(data);
    return await this.repository.save(activity);
  }

  async findBySurgeryRequest(
    surgeryRequestId: string,
  ): Promise<SurgeryRequestActivity[]> {
    return await this.repository.find({
      where: { surgery_request_id: surgeryRequestId },
      relations: ['user'],
      order: { created_at: 'ASC' },
    });
  }
}
