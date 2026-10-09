import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { ClinicalRecord } from 'src/database/entities/clinical-record.entity';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';
import { ClinicalRecordRepository } from 'src/database/repositories/clinical-record.repository';
import { SurgeryRequestFromIndicationService } from 'src/modules/surgery-requests/creation/surgery-request-from-indication.service';
import { SurgeryRequestRealtimeService } from 'src/modules/surgery-requests/realtime/surgery-request-realtime.service';
import { executeInTransaction } from 'src/shared/utils/transaction.util';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { IndicationDocumentsJobsService } from './indication-documents-jobs.service';

const SWEEP_BATCH_SIZE = 50;

@Injectable()
export class SurgicalIndicationService {
  private readonly logger = new Logger(SurgicalIndicationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly clinicalRecordRepository: ClinicalRecordRepository,
    private readonly fromIndicationService: SurgeryRequestFromIndicationService,
    private readonly realtimeService: SurgeryRequestRealtimeService,
    private readonly indicationDocumentsJobsService: IndicationDocumentsJobsService,
    private readonly accessControlService: AccessControlService,
  ) {}

  async createForRecord(
    recordId: string,
    actorUserId?: string,
  ): Promise<SurgeryRequest | null> {
    let source: Pick<
      ClinicalRecord,
      'patientId' | 'ownerId' | 'doctorId'
    > | null = null;

    const created = await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const recordRepo = manager.getRepository(ClinicalRecord);
        const record = await recordRepo.findOne({
          where: { id: recordId },
          lock: { mode: 'pessimistic_write' },
        });

        if (
          !record ||
          !record.surgicalIndication ||
          !record.finalizedAt ||
          record.surgeryRequestId
        ) {
          return null;
        }

        if (
          !(await this.accessControlService.canIndicateSurgery(record.doctorId))
        ) {
          this.logger.warn(
            `Ficha ${record.id}: indicação cirúrgica ignorada — o profissional ${record.doctorId} não é médico (CRM) com número e UF.`,
          );
          return null;
        }

        const surgeryRequest =
          await this.fromIndicationService.createPendingFromIndication({
            manager,
            ownerId: record.ownerId,
            doctorId: record.doctorId,
            createdById: record.doctorId,
            patientId: record.patientId,
            cidCode: record.cidCodes?.[0]?.code ?? null,
            procedureId: record.procedureId ?? null,
          });

        await recordRepo.update(record.id, {
          surgeryRequestId: surgeryRequest.id,
        });

        source = {
          patientId: record.patientId,
          ownerId: record.ownerId,
          doctorId: record.doctorId,
        };

        return surgeryRequest;
      },
      { logger: this.logger, operationName: 'createForRecord' },
    );

    if (created && source) {
      const { patientId, ownerId, doctorId } = source;
      try {
        await this.indicationDocumentsJobsService.schedule({
          patientId,
          surgeryRequestId: created.id,
          ownerId,
          createdById: doctorId,
        });
      } catch (err: any) {
        this.logger.warn(
          `SC ${created.id} criada, mas a cópia dos documentos não foi agendada: ${err?.message}`,
        );
      }

      try {
        await this.realtimeService.broadcastChange(
          created.id,
          'created',
          actorUserId,
        );
      } catch (err: any) {
        this.logger.warn(
          `SC ${created.id} criada, mas o broadcast falhou: ${err?.message}`,
        );
      }
    }

    return created;
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handlePendingIndicationsCron(): Promise<void> {
    try {
      const created = await this.sweepPendingIndications();
      if (created > 0) {
        this.logger.log(
          `SCs criadas a partir de atendimentos pendentes: ${created}`,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `Erro no cron de indicações cirúrgicas: ${err?.message}`,
      );
    }
  }

  async sweepPendingIndications(): Promise<number> {
    const pending =
      await this.clinicalRecordRepository.findPendingSurgicalIndications(
        SWEEP_BATCH_SIZE,
      );

    let created = 0;
    for (const record of pending) {
      try {
        if (await this.createForRecord(record.id)) created++;
      } catch (err: any) {
        this.logger.warn(
          `Falha ao criar SC da ficha ${record.id}: ${err?.message}`,
        );
      }
    }
    return created;
  }
}
