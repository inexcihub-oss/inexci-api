import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { ClinicalRecord } from 'src/database/entities/clinical-record.entity';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';
import { ClinicalRecordRepository } from 'src/database/repositories/clinical-record.repository';
import { SurgeryRequestFromIndicationService } from 'src/modules/surgery-requests/creation/surgery-request-from-indication.service';
import { SurgeryRequestRealtimeService } from 'src/modules/surgery-requests/realtime/surgery-request-realtime.service';
import { executeInTransaction } from 'src/shared/utils/transaction.util';

/** Teto por rodada — o cron roda de novo em 10 min se sobrar trabalho. */
const SWEEP_BATCH_SIZE = 50;

/**
 * Garante que toda ficha finalizada com indicação cirúrgica tenha uma SC.
 *
 * O `finalize` chama isto logo depois de gravar a ficha, mas de forma
 * best-effort: o atendimento não pode ser bloqueado por uma falha na criação da
 * SC. O que impede a perda é o estado da própria ficha — "finalizada + com
 * indicação + sem SC" é a fila de trabalho, varrida pelo cron.
 */
@Injectable()
export class SurgicalIndicationService {
  private readonly logger = new Logger(SurgicalIndicationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly clinicalRecordRepository: ClinicalRecordRepository,
    private readonly fromIndicationService: SurgeryRequestFromIndicationService,
    private readonly realtimeService: SurgeryRequestRealtimeService,
  ) {}

  /**
   * Cria a SC da ficha, se ainda não existir. Devolve `null` quando não havia
   * nada a fazer (ficha inexistente, sem marcador, não finalizada, ou já com SC).
   *
   * Idempotente sob concorrência: a leitura com `FOR UPDATE` serializa esta
   * chamada com o sweeper e com outras instâncias da API. Quem chegar depois
   * relê a linha commitada, vê `surgeryRequestId` preenchido e desiste.
   */
  async createForRecord(
    recordId: string,
    actorUserId?: string,
  ): Promise<SurgeryRequest | null> {
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

        const surgeryRequest =
          await this.fromIndicationService.createPendingFromIndication({
            manager,
            ownerId: record.ownerId,
            doctorId: record.doctorId,
            createdById: record.doctorId,
            patientId: record.patientId,
            cidCode: record.cidCodes?.[0]?.code ?? null,
          });

        // Escrita direta pelo manager, não via ClinicalRecordsService.update:
        // aquele caminho recusa fichas finalizadas, e aqui a ficha está
        // finalizada por definição.
        await recordRepo.update(record.id, {
          surgeryRequestId: surgeryRequest.id,
        });

        return surgeryRequest;
      },
      { logger: this.logger, operationName: 'createForRecord' },
    );

    if (created) {
      // Depois do commit: o broadcast relê a SC no banco.
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

  /**
   * Rede de segurança da criação inline. O `@Cron` vive no próprio serviço, como
   * em `AppointmentReminderService`, em vez de passar pelo `CronService`.
   */
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

  /** Retoma as fichas cuja SC não foi criada na finalização. */
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
