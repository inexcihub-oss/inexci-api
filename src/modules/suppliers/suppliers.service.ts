import { Logger, Injectable, NotFoundException } from '@nestjs/common';
import { FindManySupplierDto } from './dto/find-many-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { SupplierRepository } from 'src/database/repositories/supplier.repository';
import { FindOptionsWhere, In } from 'typeorm';
import { Supplier } from 'src/database/entities/supplier.entity';
import { AccessControlService } from 'src/shared/services/access-control.service';

@Injectable()
export class SuppliersService {
  private readonly logger = new Logger(SuppliersService.name);
  constructor(
    private readonly supplierRepository: SupplierRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  async findAll(query: FindManySupplierDto, userId: string) {
    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);
    if (doctorIds.length === 0) {
      return { total: 0, records: [] };
    }

    const where: FindOptionsWhere<Supplier> = {
      doctor_id: In(doctorIds),
    };

    const [total, records] = await Promise.all([
      this.supplierRepository.total(where),
      this.supplierRepository.findMany(where, query.skip, query.take),
    ]);

    return { total, records };
  }

  async findById(id: string): Promise<Supplier> {
    const supplier = await this.supplierRepository.findByIdWithQuotations(id);
    if (!supplier) throw new NotFoundException('Fornecedor não encontrado');
    return supplier;
  }

  async update(id: string, data: UpdateSupplierDto): Promise<Supplier> {
    const supplier = await this.supplierRepository.findOne({ id });
    if (!supplier) throw new NotFoundException('Fornecedor não encontrado');
    return this.supplierRepository.update(id, data);
  }

  async create(data: CreateSupplierDto, userId: string): Promise<Supplier> {
    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);
    const doctorId = doctorIds.includes(userId)
      ? userId
      : doctorIds[0] || userId;

    return this.supplierRepository.create({
      ...data,
      doctor_id: doctorId,
    });
  }

  async delete(id: string): Promise<void> {
    const supplier = await this.supplierRepository.findOne({ id });
    if (!supplier) throw new NotFoundException('Fornecedor não encontrado');
    await this.supplierRepository.delete(id);
  }
}
