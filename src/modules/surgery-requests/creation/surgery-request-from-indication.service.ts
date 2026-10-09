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

const MAX_CID_CODE_LENGTH = 10;

export interface CreatePendingFromIndicationParams {
  manager: EntityManager;
  ownerId: string;
  doctorId: string;
  createdById: string;
  patientId: string;
  cidCode?: string | null;
  procedureId?: string | null;
}

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
      procedureId: params.procedureId ?? null,
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
