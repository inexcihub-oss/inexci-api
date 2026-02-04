import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateOpmeDto } from './dto/create-opme.dto';
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
}
