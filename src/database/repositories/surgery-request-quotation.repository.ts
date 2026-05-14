import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import { SurgeryRequestQuotation } from '../entities/surgery-request-quotation.entity';
import { BaseRepository } from './base.repository';

@Global()
@Injectable()
export class SurgeryRequestQuotationRepository extends BaseRepository<SurgeryRequestQuotation> {
  constructor(
    @InjectRepository(SurgeryRequestQuotation)
    repository: Repository<SurgeryRequestQuotation>,
  ) {
    super(repository);
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

    return (await this.repository.findOne({
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
    }))!;
  }
}
