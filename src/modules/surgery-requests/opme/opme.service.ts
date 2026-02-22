import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateOpmeDto } from './dto/create-opme.dto';
import { UpdateOpmeDto } from './dto/update-opme.dto';
import { OpmeItemRepository } from 'src/database/repositories/opme-item.repository';
import { SurgeryRequestsService } from '../surgery-requests.service';

@Injectable()
export class OpmeService {
  constructor(
    private readonly opmeItemRepository: OpmeItemRepository,
    private readonly surgeryRequestService: SurgeryRequestsService,
  ) {}

  async create(data: CreateOpmeDto, userId: string) {
    const surgeryRequest = await this.surgeryRequestService.findOne(
      data.surgery_request_id,
      userId,
    );
    if (!surgeryRequest)
      throw new NotFoundException('Surgery request not found');

    const opmeItemCreated = await this.opmeItemRepository.create({
      name: data.name,
      brand: data.brand,
      distributor: data.distributor,
      quantity: data.quantity,
      surgery_request_id: data.surgery_request_id,
    });

    return opmeItemCreated;
  }

  async update(data: UpdateOpmeDto, userId: string) {
    const opmeItem = await this.opmeItemRepository.findOne({ id: data.id });
    if (!opmeItem) throw new NotFoundException('OPME item not found');

    // Verificar se o usuário tem acesso à solicitação
    const surgeryRequest = await this.surgeryRequestService.findOne(
      opmeItem.surgery_request_id,
      userId,
    );
    if (!surgeryRequest)
      throw new NotFoundException('Surgery request not found');

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.brand !== undefined) updateData.brand = data.brand;
    if (data.distributor !== undefined) updateData.distributor = data.distributor;
    if (data.quantity !== undefined) updateData.quantity = data.quantity;

    await this.opmeItemRepository.update(data.id, updateData);

    return { message: 'OPME atualizado com sucesso' };
  }

  async delete(id: string, userId: string) {
    const opmeItem = await this.opmeItemRepository.findOne({ id });
    if (!opmeItem) throw new NotFoundException('OPME item not found');

    // Verificar se o usuário tem acesso à solicitação
    const surgeryRequest = await this.surgeryRequestService.findOne(
      opmeItem.surgery_request_id,
      userId,
    );
    if (!surgeryRequest)
      throw new NotFoundException('Surgery request not found');

    await this.opmeItemRepository.delete(id);

    return { message: 'OPME removido com sucesso' };
  }
}
