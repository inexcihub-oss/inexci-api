import {
  Logger,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { MessageResponse } from 'src/shared/types/api-responses';
import { CreateOpmeDto } from './dto/create-opme.dto';
import { UpdateOpmeDto } from './dto/update-opme.dto';
import { OpmeItemRepository } from 'src/database/repositories/opme-item.repository';
import { SupplierRepository } from 'src/database/repositories/supplier.repository';
import { ManufacturerRepository } from 'src/database/repositories/manufacturer.repository';
import { SurgeryRequestAccessValidator } from 'src/shared/services/surgery-request-access.validator';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';
import { Supplier } from 'src/database/entities/supplier.entity';
import { Manufacturer } from 'src/database/entities/manufacturer.entity';
import { OpmeItem } from 'src/database/entities/opme-item.entity';
import { CreateOpmeResponseDto } from './dto/opme-response.dto';

const MIN_OPME_OPTIONS = 3;

interface ResolveSuppliersResult {
  suppliers: Supplier[];
  createdSupplierNames: string[];
}

interface ResolveManufacturersResult {
  manufacturers: Manufacturer[];
  createdManufacturerNames: string[];
}

export interface UpdateOpmeResponse extends MessageResponse {
  createdSupplierNames: string[];
  createdManufacturerNames: string[];
}

@Injectable()
export class OpmeService {
  private readonly logger = new Logger(OpmeService.name);
  constructor(
    private readonly opmeItemRepository: OpmeItemRepository,
    private readonly supplierRepository: SupplierRepository,
    private readonly manufacturerRepository: ManufacturerRepository,
    private readonly surgeryRequestAccessValidator: SurgeryRequestAccessValidator,
  ) {}

  async create(
    data: CreateOpmeDto,
    userId: string,
  ): Promise<CreateOpmeResponseDto> {
    this.validateMinManufacturers(data.manufacturerIds, data.manufacturerNames);
    this.validateMinSuppliers(data.supplierIds, data.supplierNames);

    const surgeryRequest =
      await this.surgeryRequestAccessValidator.validateAndFetch(
        data.surgeryRequestId,
        userId,
      );

    const { suppliers, createdSupplierNames } = await this.resolveSuppliers(
      data.supplierIds,
      data.supplierNames,
      surgeryRequest.ownerId,
    );

    const { manufacturers, createdManufacturerNames } =
      await this.resolveManufacturers(
        data.manufacturerIds,
        data.manufacturerNames,
        surgeryRequest.ownerId,
      );

    const entity = this.opmeItemRepository.getRepository().create({
      name: data.name,
      quantity: data.quantity,
      surgeryRequestId: data.surgeryRequestId,
      suppliers,
      manufacturers,
    });

    const saved = await this.opmeItemRepository.getRepository().save(entity);

    return this.toCreateResponse(
      saved,
      createdSupplierNames,
      createdManufacturerNames,
    );
  }

  async update(
    data: UpdateOpmeDto,
    userId: string,
  ): Promise<UpdateOpmeResponse> {
    const opmeItem = await this.opmeItemRepository.findByIdWithSuppliers(
      data.id,
    );
    if (!opmeItem)
      throw new NotFoundException(ERROR_MESSAGES.OPME_ITEM_NOT_FOUND);

    const surgeryRequest =
      await this.surgeryRequestAccessValidator.validateAndFetch(
        opmeItem.surgeryRequestId,
        userId,
      );

    if (data.name !== undefined) opmeItem.name = data.name;

    let createdSupplierNames: string[] = [];
    let createdManufacturerNames: string[] = [];

    if (
      data.manufacturerIds !== undefined ||
      data.manufacturerNames !== undefined
    ) {
      this.validateMinManufacturers(
        data.manufacturerIds,
        data.manufacturerNames,
      );

      const resolvedManufacturers = await this.resolveManufacturers(
        data.manufacturerIds,
        data.manufacturerNames,
        surgeryRequest.ownerId,
      );

      opmeItem.manufacturers = resolvedManufacturers.manufacturers;
      createdManufacturerNames = resolvedManufacturers.createdManufacturerNames;
    }

    if (data.quantity !== undefined) opmeItem.quantity = data.quantity;

    if (data.supplierIds !== undefined || data.supplierNames !== undefined) {
      this.validateMinSuppliers(data.supplierIds, data.supplierNames);
      const resolvedSuppliers = await this.resolveSuppliers(
        data.supplierIds,
        data.supplierNames,
        surgeryRequest.ownerId,
      );
      opmeItem.suppliers = resolvedSuppliers.suppliers;
      createdSupplierNames = resolvedSuppliers.createdSupplierNames;
    }

    await this.opmeItemRepository.saveWithSuppliers(opmeItem);

    return {
      message: 'OPME atualizado com sucesso',
      createdSupplierNames,
      createdManufacturerNames,
    };
  }

  async delete(id: string, userId: string): Promise<MessageResponse> {
    const opmeItem = await this.opmeItemRepository.findByIdWithSuppliers(id);
    if (!opmeItem)
      throw new NotFoundException(ERROR_MESSAGES.OPME_ITEM_NOT_FOUND);

    await this.surgeryRequestAccessValidator.validateAndFetch(
      opmeItem.surgeryRequestId,
      userId,
    );

    // Limpa as junction tables antes de remover
    opmeItem.suppliers = [];
    opmeItem.manufacturers = [];
    await this.opmeItemRepository.saveWithSuppliers(opmeItem);
    await this.opmeItemRepository.getRepository().remove(opmeItem);

    return { message: 'OPME removido com sucesso' };
  }

  private toCreateResponse(
    item: OpmeItem,
    createdSupplierNames: string[],
    createdManufacturerNames: string[],
  ): CreateOpmeResponseDto {
    return {
      id: item.id,
      surgeryRequestId: item.surgeryRequestId,
      name: item.name,
      quantity: item.quantity,
      authorizedQuantity: item.authorizedQuantity,
      selectedSupplierId: item.selectedSupplierId,
      suppliers: (item.suppliers ?? []).map((supplier) => ({
        id: supplier.id,
        name: supplier.name,
      })),
      manufacturers: (item.manufacturers ?? []).map((manufacturer) => ({
        id: manufacturer.id,
        name: manufacturer.name,
      })),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      createdSupplierNames,
      createdManufacturerNames,
    };
  }

  private validateMinManufacturers(
    manufacturerIds: string[] = [],
    manufacturerNames: string[] = [],
  ): void {
    const total =
      manufacturerIds.length +
      manufacturerNames.filter((name) => name.trim()).length;

    if (total < MIN_OPME_OPTIONS) {
      throw new BadRequestException(ERROR_MESSAGES.OPME_MIN_MANUFACTURERS);
    }
  }

  private validateMinSuppliers(ids: string[] = [], names: string[] = []): void {
    const filled = ids.length + names.filter((n) => n.trim()).length;
    if (filled < MIN_OPME_OPTIONS) {
      throw new BadRequestException(ERROR_MESSAGES.OPME_MIN_SUPPLIERS);
    }
  }

  private async resolveSuppliers(
    ids: string[] = [],
    names: string[] = [],
    ownerId: string,
  ): Promise<ResolveSuppliersResult> {
    const result: Supplier[] = [];
    const createdSupplierNames: string[] = [];
    const addedIds = new Set<string>();
    const addedNamesNormalized = new Set<string>();

    for (const id of ids) {
      const supplier = await this.supplierRepository.findOne({ id });
      if (!supplier) continue;
      if (addedIds.has(supplier.id)) continue;

      result.push(supplier);
      addedIds.add(supplier.id);
      addedNamesNormalized.add(supplier.name.trim().toLowerCase());
    }

    for (const name of names) {
      const trimmed = name.trim();
      if (!trimmed) continue;

      const normalized = trimmed.toLowerCase();
      if (addedNamesNormalized.has(normalized)) continue;

      const existing = await this.supplierRepository.findByNameIncludingDeleted(
        ownerId,
        trimmed,
      );

      if (existing) {
        if (existing.deletedAt) {
          await this.supplierRepository.restore(existing.id);
        }

        if (!addedIds.has(existing.id)) {
          const activeSupplier =
            (await this.supplierRepository.findOne({ id: existing.id })) ??
            existing;
          result.push(activeSupplier);
          addedIds.add(existing.id);
        }
        addedNamesNormalized.add(existing.name.trim().toLowerCase());
        continue;
      }

      const newSupplier = await this.supplierRepository.create({
        name: trimmed,
        ownerId,
      });
      result.push(newSupplier);
      createdSupplierNames.push(newSupplier.name);
      addedIds.add(newSupplier.id);
      addedNamesNormalized.add(newSupplier.name.trim().toLowerCase());
    }

    return {
      suppliers: result,
      createdSupplierNames,
    };
  }

  private async resolveManufacturers(
    manufacturerIds: string[] = [],
    manufacturerNames: string[] = [],
    ownerId: string,
  ): Promise<ResolveManufacturersResult> {
    const result: Manufacturer[] = [];
    const createdManufacturerNames: string[] = [];
    const addedIds = new Set<string>();
    const addedNamesNormalized = new Set<string>();

    for (const id of manufacturerIds) {
      const manufacturer = await this.manufacturerRepository
        .getRepository()
        .findOne({
          where: {
            id,
            ownerId,
          },
        });

      if (!manufacturer) continue;
      if (addedIds.has(manufacturer.id)) continue;

      result.push(manufacturer);
      addedIds.add(manufacturer.id);
      addedNamesNormalized.add(manufacturer.name.trim().toLowerCase());
    }

    for (const name of manufacturerNames) {
      const trimmed = name.trim();
      if (!trimmed) continue;

      const normalized = trimmed.toLowerCase();
      if (addedNamesNormalized.has(normalized)) continue;

      const existing =
        await this.manufacturerRepository.findByNameIncludingDeleted(
          ownerId,
          trimmed,
        );

      if (existing) {
        if (existing.deletedAt) {
          await this.manufacturerRepository.restore(existing.id);
        }

        if (!addedIds.has(existing.id)) {
          const activeManufacturer =
            (await this.manufacturerRepository.findOne({ id: existing.id })) ??
            existing;
          result.push(activeManufacturer);
          addedIds.add(existing.id);
        }
        addedNamesNormalized.add(existing.name.trim().toLowerCase());
        continue;
      }

      const newManufacturer = await this.manufacturerRepository.create({
        name: trimmed,
        ownerId,
      });
      result.push(newManufacturer);
      createdManufacturerNames.push(newManufacturer.name);
      addedIds.add(newManufacturer.id);
      addedNamesNormalized.add(newManufacturer.name.trim().toLowerCase());
    }

    return {
      manufacturers: result,
      createdManufacturerNames,
    };
  }
}
