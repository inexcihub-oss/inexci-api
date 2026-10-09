import { Injectable, NotFoundException } from '@nestjs/common';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { AccessControlService } from './access-control.service';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';

@Injectable()
export class SurgeryRequestAccessValidator {
  constructor(
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  async validateAndFetch(
    surgeryRequestId: string,
    userId: string,
  ): Promise<SurgeryRequest> {
    const where = await this.accessControlService.buildSurgeryAccessWhere(
      { id: surgeryRequestId },
      userId,
    );
    const request = await this.surgeryRequestRepository.findOneSimple(where);
    if (!request)
      throw new NotFoundException('Solicitação cirúrgica não encontrada');

    return request;
  }
}
