import { Logger, Injectable, NotFoundException } from '@nestjs/common';
import { MessageResponse } from 'src/shared/types/api-responses';
import { CreateOpmeDto } from './dto/create-opme.dto';
import { UpdateOpmeDto } from './dto/update-opme.dto';
import { OpmeItemRepository } from 'src/database/repositories/opme-item.repository';
import { SupplierRepository } from 'src/database/repositories/supplier.repository';
import { SurgeryRequestAccessValidator } from 'src/shared/services/surgery-request-access.validator';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';
import { Supplier } from 'src/database/entities/supplier.entity';

@Injectable()
export class OpmeService {
  private readonly logger = new Logger(OpmeService.name);
  constructor(
    private readonly opmeItemRepository: OpmeItemRepository,
    private readonly supplierRepository: SupplierRepository,
    private readonly surgeryRequestAccessValidator: SurgeryRequestAccessValidator,
  ) {}

  async create(data: CreateOpmeDto, userId: string) {
    const surgeryRequest =
      await this.surgeryRequestAccessValidator.validateAndFetch(
        data.surgery_request_id,
        userId,
      );

    const suppliers = await this.resolveSuppliers(
      data.supplier_ids,
      data.supplier_names,
      surgeryRequest.doctor_id,
    );

    const entity = this.opmeItemRepository.getRepository().create({
      name: data.name,
      brand: data.brand,
      quantity: data.quantity,
      surgery_request_id: data.surgery_request_id,
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
        opmeItem.surgery_request_id,
        userId,
      );

    if (data.name !== undefined) opmeItem.name = data.name;
    if (data.brand !== undefined) opmeItem.brand = data.brand;
    if (data.quantity !== undefined) opmeItem.quantity = data.quantity;

    if (data.supplier_ids !== undefined || data.supplier_names !== undefined) {
      opmeItem.suppliers = await this.resolveSuppliers(
        data.supplier_ids,
        data.supplier_names,
        surgeryRequest.doctor_id,
      );
    }

    await this.opmeItemRepository.saveWithSuppliers(opmeItem);

    return { message: 'OPME atualizado com sucesso' };
  }

  async delete(id: string, userId: string): Promise<MessageResponse> {
    const opmeItem = await this.opmeItemRepository.findOne({ id });
    if (!opmeItem)
      throw new NotFoundException(ERROR_MESSAGES.OPME_ITEM_NOT_FOUND);

    await this.surgeryRequestAccessValidator.validateAndFetch(
      opmeItem.surgery_request_id,
      userId,
    );

    await this.opmeItemRepository.delete(id);

    return { message: 'OPME removido com sucesso' };
  }

  private async resolveSuppliers(
    ids: string[] = [],
    names: string[] = [],
    doctorId: string,
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
        doctor_id: doctorId,
        active: true,
      });
      result.push(newSupplier);
    }

    return result;
  }
}
