import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';
import { StatusUpdate } from 'src/database/entities/status-update.entity';
import {
  SurgeryRequestActivity,
  ActivityType,
} from 'src/database/entities/surgery-request-activity.entity';

import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { SurgeryRequestNotificationService } from './surgery-request-notification.service';

import { getStatusLabel } from 'src/shared/utils';

/**
 * Métodos legados mantidos para compatibilidade temporária.
 * Devem ser removidos quando o frontend migrar para os endpoints granulares.
 */
@Injectable()
export class SurgeryRequestLegacyService {
  private readonly logger = new Logger(SurgeryRequestLegacyService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly notificationService: SurgeryRequestNotificationService,
  ) {}

  private async loadRequestWithRelations(id: string): Promise<SurgeryRequest> {
    const request = await this.surgeryRequestRepository.findOneWithRelations(
      { id },
      [
        'created_by',
        'patient',
        'hospital',
        'health_plan',
        'tuss_items',
        'opme_items',
        'documents',
        'analysis',
        'billing',
        'contestations',
      ],
    );
    if (!request) throw new NotFoundException('Solicitação não encontrada');
    return request;
  }

  async updateStatus(
    surgeryRequestId: string,
    newStatus: number,
    userId: string,
    notifyPatient?: boolean,
  ) {
    const request = await this.surgeryRequestRepository.findOneSimple({
      id: surgeryRequestId,
    });
    if (!request) throw new NotFoundException('Solicitação não encontrada');

    const validStatuses = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    if (!validStatuses.includes(newStatus)) {
      throw new BadRequestException(`Status inválido: ${newStatus}`);
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SurgeryRequest);
      const statusUpdateRepo = manager.getRepository(StatusUpdate);
      await repo.update({ id: surgeryRequestId }, { status: newStatus });
      await statusUpdateRepo.save({
        surgery_request_id: surgeryRequestId,
        prev_status: request.status,
        new_status: newStatus,
      });
      const activityRepo = manager.getRepository(SurgeryRequestActivity);
      const prevLabel = getStatusLabel(request.status);
      const newLabel = getStatusLabel(newStatus);
      await activityRepo.save({
        surgery_request_id: surgeryRequestId,
        user_id: userId,
        type: ActivityType.STATUS_CHANGE,
        content: `Status alterado de "${prevLabel}" para "${newLabel}"`,
      });
      return repo.findOne({ where: { id: surgeryRequestId } });
    });

    if (notifyPatient) {
      const fullRequest = await this.loadRequestWithRelations(surgeryRequestId);
      await this.notificationService.notifyPatientIfRequested(
        fullRequest,
        request.status,
        newStatus,
        true,
      );
    }

    return result;
  }

  async dateExpired() {
    const surgeryRequests = await this.surgeryRequestRepository.findMany(
      { status: SurgeryRequestStatus.IN_ANALYSIS },
      0,
      1000,
    );

    return surgeryRequests
      .map((sr) => {
        const createdAt = sr.status_updates?.[0]?.created_at;
        const days = calculateDaysDifference(createdAt);
        return { ...sr, daysDifference: days };
      })
      .filter(
        (sr) =>
          sr.daysDifference >= 21 && (!sr.date_call || !sr.hospital_protocol),
      );
  }
}

function calculateDaysDifference(date: Date): number {
  if (!date) return 0;
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
