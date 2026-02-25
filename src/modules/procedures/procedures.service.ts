import { Injectable } from '@nestjs/common';
import { FindManyProcedureDto } from './dto/find-many-procedure.dto';
import { CreateProcedureDto } from './dto/create-procedure.dto';
import { ProcedureRepository } from 'src/database/repositories/procedure.repository';
import { Procedure } from 'src/database/entities/procedure.entity';

@Injectable()
export class ProceduresService {
  constructor(private readonly procedureRepository: ProcedureRepository) {}

  async findAll(query: FindManyProcedureDto) {
    const [records, total] = await Promise.all([
      this.procedureRepository.findMany({}, query.skip, query.take),
      this.procedureRepository.total({}),
    ]);

    return { total, records };
  }

  async create(data: CreateProcedureDto): Promise<Procedure> {
    return this.procedureRepository.create(data);
  }
}
