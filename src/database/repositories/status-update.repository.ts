import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StatusUpdate } from '../entities/status-update.entity';
import { BaseRepository } from './base.repository';

@Global()
@Injectable()
export class StatusUpdateRepository extends BaseRepository<StatusUpdate> {
  constructor(
    @InjectRepository(StatusUpdate)
    repository: Repository<StatusUpdate>,
  ) {
    super(repository);
  }

  async findMany(): Promise<StatusUpdate[]> {
    return await this.repository.find();
  }
}
