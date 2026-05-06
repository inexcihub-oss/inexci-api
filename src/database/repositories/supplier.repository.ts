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

  findByDoctorId(doctorId: string): Promise<Supplier[]> {
    return this.repository.find({
      where: { doctor_id: doctorId },
      order: { name: 'ASC' },
    });
  }

  findByIdWithQuotations(id: string): Promise<Supplier | null> {
    return this.repository.findOne({
      where: { id },
      relations: [
        'quotations',
        'quotations.surgery_request',
        'quotations.surgery_request.patient',
      ],
      order: { quotations: { created_at: 'DESC' } },
    });
  }
}
