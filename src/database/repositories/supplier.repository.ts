import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { Supplier } from '../entities/supplier.entity';

@Injectable()
export class SupplierRepository {
  private repository: Repository<Supplier>;

  constructor(private readonly dataSource: DataSource) {
    this.repository = this.dataSource.getRepository(Supplier);
  }

  async findOne(where: FindOptionsWhere<Supplier>): Promise<Supplier | null> {
    return this.repository.findOne({ where });
  }

  async findMany(
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

  async total(
    where: FindOptionsWhere<Supplier> | FindOptionsWhere<Supplier>[],
  ): Promise<number> {
    return this.repository.count({ where });
  }

  async create(data: Partial<Supplier>): Promise<Supplier> {
    const supplier = this.repository.create(data);
    return this.repository.save(supplier);
  }

  async update(id: string, data: Partial<Supplier>): Promise<Supplier | null> {
    await this.repository.update(id, data);
    return this.findOne({ id });
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  async findByDoctorId(doctorId: string): Promise<Supplier[]> {
    return this.repository.find({
      where: { doctor_id: doctorId },
      order: { name: 'ASC' },
    });
  }
}
