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
import {
  bulkDeleteOwned,
  createOrRestoreByName,
  findOwnedOrFail,
  resolveCatalogOwnerId,
} from 'src/shared/catalog/owned-catalog.helpers';
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

    const where: FindOptionsWhere<Supplier> = { ownerId, isGeneric: false };

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

  private assertNaoEGenerico(registro: { isGeneric?: boolean }): void {
    if (registro.isGeneric) {
      throw new ForbiddenException(
        'O fornecedor "Outro" é da plataforma e não pode ser alterado nem excluído.',
      );
    }
  }

  async update(
    id: string,
    data: UpdateSupplierDto,
    userId: string,
  ): Promise<Supplier> {
    const registro = await this.findOwned(id, userId);
    this.assertNaoEGenerico(registro);
    return (await this.supplierRepository.update(id, data))!;
  }

  async create(data: CreateSupplierDto, userId: string): Promise<Supplier> {
    const ownerId = await resolveCatalogOwnerId(
      this.accessControlService,
      userId,
    );

    return createOrRestoreByName({
      repository: this.supplierRepository,
      ownerId,
      data,
      conflictMessage: (nome) =>
        `Já existe um fornecedor com o nome "${nome}".`,
      logger: this.logger,
    });
  }

  async delete(id: string, userId: string): Promise<void> {
    const registro = await this.findOwned(id, userId);
    this.assertNaoEGenerico(registro);
    await this.supplierRepository.softDelete(id);
    this.logger.log(`Fornecedor soft-deleted: id=${id}`);
  }

  async bulkDelete(
    ids: string[],
    userId: string,
  ): Promise<{ deleted: number }> {
    const ownerId = await resolveCatalogOwnerId(
      this.accessControlService,
      userId,
    );
    const result = await bulkDeleteOwned({
      repository: this.supplierRepository,
      ids,
      ownerId,
      notFoundMessage: 'Um ou mais fornecedores não foram encontrados.',
      guard: (registro) => this.assertNaoEGenerico(registro),
    });
    this.logger.log(
      `Fornecedores soft-deleted em lote: total=${result.deleted}`,
    );
    return result;
  }

  private findOwned(id: string, userId: string): Promise<Supplier> {
    return findOwnedOrFail(
      this.supplierRepository,
      this.accessControlService,
      id,
      userId,
      'Fornecedor não encontrado',
    );
  }
}
