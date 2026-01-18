import { Injectable } from '@nestjs/common';
import { FindManyProcedureDto } from './dto/find-many-procedure.dto';
import { ProcedureRepository } from 'src/database/repositories/procedure.repository';
import { FindOptionsWhere } from 'typeorm';
import { Procedure } from 'src/database/entities/procedure.entity';

@Injectable()
export class ProceduresService {
  constructor(private readonly procedureRepository: ProcedureRepository) {}

  async findAll(query: FindManyProcedureDto) {
    const where: FindOptionsWhere<Procedure> = { active: true };

    const [records, total] = await Promise.all([
      this.procedureRepository.findMany(where, query.skip, query.take),
      this.procedureRepository.total(where),
    ]);

    return { total, records };
  }
}
