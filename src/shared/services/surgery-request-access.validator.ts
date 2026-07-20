import { Injectable, NotFoundException } from '@nestjs/common';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { AccessControlService } from './access-control.service';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';

/**
 * Valida se um usuário tem acesso a uma solicitação cirúrgica e retorna
 * a solicitação (sem relações) caso o acesso seja permitido.
 *
 * Use este serviço em vez de injetar `SurgeryRequestsService` quando
 * o único objetivo for verificar acesso ou obter dados básicos da solicitação.
 */
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
    // Fail-closed: escopa por ownerId do tenant do usuário (V1).
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
