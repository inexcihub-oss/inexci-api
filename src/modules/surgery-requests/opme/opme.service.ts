import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateOpmeDto } from './dto/create-opme.dto';
import { OpmeItemRepository } from 'src/database/repositories/opme-item.repository';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { SurgeryRequestsService } from '../surgery-requests.service';
import { PendenciesService } from '../pendencies/pendencies.service';
import { PendencyKeys } from 'src/common';
import { PendencyRepository } from 'src/database/repositories/pendency.repository';

@Injectable()
export class OpmeService {
  constructor(
    private readonly opmeItemRepository: OpmeItemRepository,
    private readonly surgeryRequestService: SurgeryRequestsService,
    private readonly pendenciesService: PendenciesService,
    private readonly pendencyRepository: PendencyRepository,
  ) {}

  async create(data: CreateOpmeDto, userId: number) {
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

    await this.pendenciesService.close({
      surgery_request_id: data.surgery_request_id,
      key: PendencyKeys.insertOpme,
    });

    return opmeItemCreated;
  }
}
