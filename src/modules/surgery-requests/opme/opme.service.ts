import { Logger, Injectable, NotFoundException } from '@nestjs/common';
import { MessageResponse } from 'src/shared/types/api-responses';
import { CreateOpmeDto } from './dto/create-opme.dto';
import { UpdateOpmeDto } from './dto/update-opme.dto';
import { OpmeItemRepository } from 'src/database/repositories/opme-item.repository';
import { SurgeryRequestAccessValidator } from 'src/shared/services/surgery-request-access.validator';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';

@Injectable()
export class OpmeService {
  private readonly logger = new Logger(OpmeService.name);
  constructor(
    private readonly opmeItemRepository: OpmeItemRepository,
    private readonly surgeryRequestAccessValidator: SurgeryRequestAccessValidator,
  ) {}

  async create(data: CreateOpmeDto, userId: string) {
    await this.surgeryRequestAccessValidator.validateAndFetch(
      data.surgery_request_id,
      userId,
    );

    return this.opmeItemRepository.create({
      name: data.name,
      brand: data.brand,
      distributor: data.distributor,
      quantity: data.quantity,
      surgery_request_id: data.surgery_request_id,
    });
  }

  async update(data: UpdateOpmeDto, userId: string): Promise<MessageResponse> {
    const opmeItem = await this.opmeItemRepository.findOne({ id: data.id });
    if (!opmeItem)
      throw new NotFoundException(ERROR_MESSAGES.OPME_ITEM_NOT_FOUND);

    await this.surgeryRequestAccessValidator.validateAndFetch(
      opmeItem.surgery_request_id,
      userId,
    );

    const updateData: Partial<{
      name: string;
      brand: string;
      distributor: string;
      quantity: number;
    }> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.brand !== undefined) updateData.brand = data.brand;
    if (data.distributor !== undefined)
      updateData.distributor = data.distributor;
    if (data.quantity !== undefined) updateData.quantity = data.quantity;

    await this.opmeItemRepository.update(data.id, updateData);

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
}
