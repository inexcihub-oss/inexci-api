import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  SurgeryRequest,
  SurgeryRequestPriority,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';
import {
  ActivityType,
  SurgeryRequestActivity,
} from 'src/database/entities/surgery-request-activity.entity';

/** `surgery_requests.cid_code` é varchar(10). */
const MAX_CID_CODE_LENGTH = 10;

export interface CreatePendingFromIndicationParams {
  /** A transação é do chamador — ele decide o que mais entra nela. */
  manager: EntityManager;
  ownerId: string;
  doctorId: string;
  createdById: string;
  patientId: string;
  cidCode?: string | null;
}

/**
 * Cria a SC mínima em Pendente que nasce de uma indicação cirúrgica feita no
 * atendimento. As pendências bloqueantes (hospital, TUSS, OPME, laudo) ficam
 * abertas de propósito: é o que o status Pendente significa, e completá-las é
 * trabalho de quem vai tocar a solicitação.
 *
 * Sem dependências injetadas — trabalha só sobre o `EntityManager` recebido,
 * para que qualquer módulo possa chamá-lo dentro da própria transação.
 */
@Injectable()
export class SurgeryRequestFromIndicationService {
  async createPendingFromIndication(
    params: CreatePendingFromIndicationParams,
  ): Promise<SurgeryRequest> {
    const surgeryRequestRepo = params.manager.getRepository(SurgeryRequest);
    const activityRepo = params.manager.getRepository(SurgeryRequestActivity);

    const request = await surgeryRequestRepo.save({
      ownerId: params.ownerId,
      doctorId: params.doctorId,
      createdById: params.createdById,
      patientId: params.patientId,
      status: SurgeryRequestStatus.PENDING,
      isIndication: false,
      priority: SurgeryRequestPriority.MEDIUM,
      cidCode: params.cidCode?.slice(0, MAX_CID_CODE_LENGTH) || null,
      lastStatusChangedAt: new Date(),
    });

    await activityRepo.save({
      surgeryRequestId: request.id,
      userId: params.createdById,
      type: ActivityType.SYSTEM,
      content: 'Solicitação cirúrgica criada a partir do atendimento',
    });

    return request;
  }
}
