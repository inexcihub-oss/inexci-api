import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SurgeryRequestProcedure } from '../entities/surgery-request-procedure.entity';
import { BaseRepository } from './base.repository';

@Global()
@Injectable()
export class SurgeryRequestProcedureRepository extends BaseRepository<SurgeryRequestProcedure> {
  constructor(
    @InjectRepository(SurgeryRequestProcedure)
    repository: Repository<SurgeryRequestProcedure>,
  ) {
    super(repository);
  }

  async create(
    data: Partial<SurgeryRequestProcedure>,
  ): Promise<SurgeryRequestProcedure> {
    const surgeryRequestProcedure = this.repository.create(data);
    const saved = await this.repository.save(surgeryRequestProcedure);

    return await this.repository.findOne({
      where: { id: saved.id },
      relations: ['procedure'],
      select: {
        id: true,
        procedure: {
          id: true,
          name: true,
        },
      },
    });
  }
}
