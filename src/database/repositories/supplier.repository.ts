import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere } from 'typeorm';
import { Supplier } from '../entities/supplier.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class SupplierRepository extends BaseRepository<Supplier> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(Supplier));
  }

  findMany(
    where: FindOptionsWhere<Supplier> | FindOptionsWhere<Supplier>[],
    skip?: number,
    take?: number,
  ): Promise<Supplier[]> {
    return this.repository.find({
      where,
      skip,
      take,
      order: { name: 'ASC' },
    });
  }

  /**
   * Lista fornecedores cadastrados pela clínica (ownerId).
   */
  findByOwnerId(ownerId: string): Promise<Supplier[]> {
    return this.repository.find({
      where: { ownerId },
      order: { name: 'ASC' },
    });
  }

  findByIdWithQuotations(id: string): Promise<Supplier | null> {
    return this.repository.findOne({
      where: { id },
      relations: [
        'quotations',
        'quotations.surgeryRequest',
        'quotations.surgeryRequest.patient',
      ],
      order: { quotations: { createdAt: 'DESC' } },
    });
  }
}
