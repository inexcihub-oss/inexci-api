import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FindManySupplierDto } from './dto/find-many-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { SupplierRepository } from 'src/database/repositories/supplier.repository';
import { FindOptionsWhere } from 'typeorm';
import { Supplier } from 'src/database/entities/supplier.entity';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { OpmeItemRepository } from 'src/database/repositories/opme-item.repository';

@Injectable()
export class SuppliersService {
  private readonly logger = new Logger(SuppliersService.name);
  constructor(
    private readonly supplierRepository: SupplierRepository,
    private readonly accessControlService: AccessControlService,
    private readonly opmeItemRepository: OpmeItemRepository,
  ) {}

  async findAll(query: FindManySupplierDto, userId: string) {
    const ownerId = await this.accessControlService.getOwnerId(userId);

    const where: FindOptionsWhere<Supplier> = { ownerId };

    const [total, records] = await Promise.all([
      this.supplierRepository.total(where),
      this.supplierRepository.findMany(where, query.skip, query.take),
    ]);

    return { total, records };
  }

  async findById(
    id: string,
    userId: string,
  ): Promise<
    Supplier & {
      suppliedSurgeryRequests: Array<{
        surgeryRequestId: string;
        surgeryRequestProtocol: string | null;
        patientName: string | null;
        opmeItemId: string;
        opmeItemName: string;
        authorizedQuantity: number | null;
        quantity: number;
        updatedAt: Date;
      }>;
    }
  > {
    const supplier = await this.supplierRepository.findByIdWithQuotations(id);
    if (!supplier) throw new NotFoundException('Fornecedor não encontrado');
    await this.accessControlService.assertSameOwner(userId, supplier.ownerId);

    const suppliedSurgeryRequests =
      await this.opmeItemRepository.findSuppliedSurgeryRequestsBySupplierId(
        supplier.id,
      );

    return {
      ...supplier,
      suppliedSurgeryRequests,
    };
  }

  async update(
    id: string,
    data: UpdateSupplierDto,
    userId: string,
  ): Promise<Supplier> {
    const supplier = await this.supplierRepository.findOne({ id });
    if (!supplier) throw new NotFoundException('Fornecedor não encontrado');
    await this.accessControlService.assertSameOwner(userId, supplier.ownerId);
    return (await this.supplierRepository.update(id, data))!;
  }

  async create(data: CreateSupplierDto, userId: string): Promise<Supplier> {
    const ownerId = await this.accessControlService.getOwnerId(userId);
    if (!ownerId) {
      throw new ForbiddenException('Usuário sem clínica vinculada.');
    }

    return this.supplierRepository.create({
      ...data,
      ownerId,
    });
  }

  async delete(id: string, userId: string): Promise<void> {
    const supplier = await this.supplierRepository.findOne({ id });
    if (!supplier) throw new NotFoundException('Fornecedor não encontrado');
    await this.accessControlService.assertSameOwner(userId, supplier.ownerId);
    await this.supplierRepository.delete(id);
  }
}
