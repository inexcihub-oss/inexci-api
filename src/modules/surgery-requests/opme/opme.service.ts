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
import { SurgeryRequestAccessValidator } from 'src/shared/services/surgery-request-access.validator';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';
import { Supplier } from 'src/database/entities/supplier.entity';

const MIN_OPME_OPTIONS = 3;

@Injectable()
export class OpmeService {
  private readonly logger = new Logger(OpmeService.name);
  constructor(
    private readonly opmeItemRepository: OpmeItemRepository,
    private readonly supplierRepository: SupplierRepository,
    private readonly surgeryRequestAccessValidator: SurgeryRequestAccessValidator,
  ) {}

  async create(data: CreateOpmeDto, userId: string) {
    this.validateMinManufacturers(data.brand);
    this.validateMinSuppliers(data.supplier_ids, data.supplier_names);

    const surgeryRequest =
      await this.surgeryRequestAccessValidator.validateAndFetch(
        data.surgeryRequestId,
        userId,
      );

    const suppliers = await this.resolveSuppliers(
      data.supplier_ids,
      data.supplier_names,
      surgeryRequest.ownerId,
    );

    const entity = this.opmeItemRepository.getRepository().create({
      name: data.name,
      brand: data.brand,
      quantity: data.quantity,
      surgeryRequestId: data.surgeryRequestId,
      suppliers,
    });

    return this.opmeItemRepository.getRepository().save(entity);
  }

  async update(data: UpdateOpmeDto, userId: string): Promise<MessageResponse> {
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

    if (data.brand !== undefined) {
      this.validateMinManufacturers(data.brand);
      opmeItem.brand = data.brand;
    }

    if (data.quantity !== undefined) opmeItem.quantity = data.quantity;

    if (data.supplier_ids !== undefined || data.supplier_names !== undefined) {
      this.validateMinSuppliers(data.supplier_ids, data.supplier_names);
      opmeItem.suppliers = await this.resolveSuppliers(
        data.supplier_ids,
        data.supplier_names,
        surgeryRequest.ownerId,
      );
    }

    await this.opmeItemRepository.saveWithSuppliers(opmeItem);

    return { message: 'OPME atualizado com sucesso' };
  }

  async delete(id: string, userId: string): Promise<MessageResponse> {
    const opmeItem = await this.opmeItemRepository.findByIdWithSuppliers(id);
    if (!opmeItem)
      throw new NotFoundException(ERROR_MESSAGES.OPME_ITEM_NOT_FOUND);

    await this.surgeryRequestAccessValidator.validateAndFetch(
      opmeItem.surgeryRequestId,
      userId,
    );

    // Limpa a junction table opme_item_supplier antes de remover
    opmeItem.suppliers = [];
    await this.opmeItemRepository.saveWithSuppliers(opmeItem);
    await this.opmeItemRepository.getRepository().remove(opmeItem);

    return { message: 'OPME removido com sucesso' };
  }

  private validateMinManufacturers(brand?: string): void {
    const count = (brand ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean).length;
    if (count < MIN_OPME_OPTIONS) {
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
  ): Promise<Supplier[]> {
    const result: Supplier[] = [];

    for (const id of ids) {
      const supplier = await this.supplierRepository.findOne({ id });
      if (supplier) result.push(supplier);
    }

    for (const name of names) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const newSupplier = await this.supplierRepository.create({
        name: trimmed,
        ownerId,
        active: true,
      });
      result.push(newSupplier);
    }

    return result;
  }
}
