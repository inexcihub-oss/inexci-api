import { Injectable, NotFoundException } from '@nestjs/common';
import { FindManyProcedureDto } from './dto/find-many-procedure.dto';
import { CreateProcedureDto } from './dto/create-procedure.dto';
import { UpdateProcedureDto } from './dto/update-procedure.dto';
import { ProcedureRepository } from 'src/database/repositories/procedure.repository';
import { Procedure } from 'src/database/entities/procedure.entity';

@Injectable()
export class ProceduresService {
  constructor(private readonly procedureRepository: ProcedureRepository) {}

  async findAll(query: FindManyProcedureDto) {
    const [records, total] = await Promise.all([
      this.procedureRepository.findMany({}, query.skip ?? 0, query.take ?? 20),
      this.procedureRepository.total({}),
    ]);

    return { total, records };
  }

  async findOne(id: string): Promise<Procedure> {
    const procedure = await this.procedureRepository.findOne({ id });
    if (!procedure) {
      throw new NotFoundException('Procedimento não encontrado');
    }
    return procedure;
  }

  create(data: CreateProcedureDto): Promise<Procedure> {
    return this.procedureRepository.create(data);
  }

  async update(id: string, data: UpdateProcedureDto): Promise<Procedure> {
    const procedure = await this.procedureRepository.findOne({ id });
    if (!procedure) {
      throw new NotFoundException('Procedimento não encontrado');
    }
    return (await this.procedureRepository.update(id, data))!;
  }

  async delete(id: string): Promise<void> {
    const procedure = await this.procedureRepository.findOne({ id });
    if (!procedure) {
      throw new NotFoundException('Procedimento não encontrado');
    }
    await this.procedureRepository.delete(id);
  }
}
