import { Injectable, NotFoundException } from '@nestjs/common';
import { In } from 'typeorm';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
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
    private readonly userRepository: UserRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  async validateAndFetch(
    surgeryRequestId: string,
    userId: string,
  ): Promise<SurgeryRequest> {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);

    const where =
      doctorIds.length > 0
        ? { id: surgeryRequestId, doctor_id: In(doctorIds) }
        : { id: surgeryRequestId };

    const request = await this.surgeryRequestRepository.findOneSimple(where);
    if (!request)
      throw new NotFoundException('Solicitação cirúrgica não encontrada');

    return request;
  }
}
