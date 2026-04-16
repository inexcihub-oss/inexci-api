import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contestation } from '../entities/contestation.entity';
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
}
