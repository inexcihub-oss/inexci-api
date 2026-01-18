import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { StatusUpdate } from '../entities/status-update.entity';

@Global()
@Injectable()
export class StatusUpdateRepository {
  constructor(
    @InjectRepository(StatusUpdate)
    private readonly repository: Repository<StatusUpdate>,
  ) {}

  async create(data: Partial<StatusUpdate>): Promise<StatusUpdate> {
    const statusUpdate = this.repository.create(data);
    return await this.repository.save(statusUpdate);
  }

  async findMany(): Promise<StatusUpdate[]> {
    return await this.repository.find();
  }
}
