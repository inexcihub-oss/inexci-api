import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SurgeryRequestAnalysis } from '../entities/surgery-request-analysis.entity';
import { BaseRepository } from './base.repository';

@Global()
@Injectable()
export class SurgeryRequestAnalysisRepository extends BaseRepository<SurgeryRequestAnalysis> {
  constructor(
    @InjectRepository(SurgeryRequestAnalysis)
    repository: Repository<SurgeryRequestAnalysis>,
  ) {
    super(repository);
  }
}
