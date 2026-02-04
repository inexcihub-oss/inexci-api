import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';

import { SurgeryRequestQuotation } from '../entities/surgery-request-quotation.entity';

@Global()
@Injectable()
export class SurgeryRequestQuotationRepository {
  constructor(
    @InjectRepository(SurgeryRequestQuotation)
    private readonly repository: Repository<SurgeryRequestQuotation>,
  ) {}

  async findOne(
    where: FindOptionsWhere<SurgeryRequestQuotation>,
  ): Promise<SurgeryRequestQuotation | null> {
    return await this.repository.findOne({ where });
  }

  async findMany(
    where: FindOptionsWhere<SurgeryRequestQuotation>,
  ): Promise<SurgeryRequestQuotation[]> {
    return await this.repository.find({ where });
  }

  async create(
    data: Partial<SurgeryRequestQuotation>,
  ): Promise<SurgeryRequestQuotation> {
    const quotation = this.repository.create(data);
    const saved = await this.repository.save(quotation);

    // Carregar com relacionamento supplier
    return await this.repository.findOne({
      where: { id: saved.id },
      relations: ['supplier'],
      select: {
        id: true,
        supplier: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
    });
  }

  async update(
    id: string,
    data: Partial<SurgeryRequestQuotation>,
  ): Promise<SurgeryRequestQuotation> {
    await this.repository.update(id, data);
    return await this.repository.findOne({ where: { id } });
  }
}
