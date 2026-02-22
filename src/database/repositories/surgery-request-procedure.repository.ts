import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SurgeryRequestProcedure } from '../entities/surgery-request-procedure.entity';

@Global()
@Injectable()
export class SurgeryRequestProcedureRepository {
  constructor(
    @InjectRepository(SurgeryRequestProcedure)
    private readonly repository: Repository<SurgeryRequestProcedure>,
  ) {}

  async create(
    data: Partial<SurgeryRequestProcedure>,
  ): Promise<SurgeryRequestProcedure> {
    const surgeryRequestProcedure = this.repository.create(data);
    const saved = await this.repository.save(surgeryRequestProcedure);

    // Carregar relacionamento procedure com campos específicos
    return await this.repository.findOne({
      where: { id: saved.id },
      relations: ['procedure'],
      select: {
        id: true,
        procedure: {
          id: true,
          name: true,
          tuss_code: true,
        },
      },
    });
  }

  async findOne(
    where: Partial<SurgeryRequestProcedure>,
  ): Promise<SurgeryRequestProcedure | null> {
    return await this.repository.findOne({ where });
  }

  async update(
    id: string,
    data: Partial<SurgeryRequestProcedure>,
  ): Promise<SurgeryRequestProcedure> {
    await this.repository.update(id, data);
    return await this.repository.findOne({ where: { id } });
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
