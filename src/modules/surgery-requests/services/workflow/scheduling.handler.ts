import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';

import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';
import { ActivityType } from 'src/database/entities/surgery-request-activity.entity';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from 'src/database/repositories/surgery-request-activity.repository';
import {
  SurgeryRequestStateMachine,
  assertTransitionApplied,
} from 'src/shared/state-machine/surgery-request-state-machine';
import { executeInTransaction } from 'src/shared/utils/transaction.util';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';

import { SurgeryRequestNotificationService } from '../surgery-request-notification.service';
import { ConfirmDateDto } from '../../dto/confirm-date.dto';
import { UpdateDateOptionsDto } from '../../dto/update-date-options.dto';
import { RescheduleDto } from '../../dto/reschedule.dto';
import { PendencyValidatorService } from '../../pendencies/pendency-validator.service';
import {
  emitSurgeryRequestStatusChanged,
  emitSurgeryRequestUpdated,
} from '../../events/surgery-request.events';
import { SchedulingSelectionStore } from './scheduling-selection.store';

export type PatientDateSelectionResult =
  | { kind: 'not_found' }
  | { kind: 'ambiguous' }
  | { kind: 'invalid_option' }
  | {
      kind: 'selected';
      request: SurgeryRequest;
      selectedIndex: number;
      selectedIso: string;
    };

@Injectable()
export class SchedulingHandler {
  private readonly logger = new Logger(SchedulingHandler.name);
  private readonly stateMachine = new SurgeryRequestStateMachine();

  constructor(
    private readonly dataSource: DataSource,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly activityRepository: SurgeryRequestActivityRepository,
    private readonly notificationService: SurgeryRequestNotificationService,
    private readonly pendencyValidator: PendencyValidatorService,
    private readonly selectionStore: SchedulingSelectionStore,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async confirmDate(id: string, dto: ConfirmDateDto, userId: string) {
    this.logger.log(`[confirmDate] Confirmando data da solicitação ${id}`);
    const request = await this.surgeryRequestRepository.findOneForWorkflow({
      id,
    });
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    this.stateMachine.assertCanTransition(
      request,
      SurgeryRequestStatus.SCHEDULED,
    );
    await this.pendencyValidator.assertCanAdvance(id);

    const dateOptions = request.dateOptions as string[];
    if (!dateOptions || dateOptions[dto.selectedDateIndex] === undefined) {
      throw new BadRequestException(ERROR_MESSAGES.INVALID_DATE_INDEX);
    }

    await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const applied =
          await this.surgeryRequestRepository.applyStatusTransition(manager, {
            id,
            from: request.status,
            to: SurgeryRequestStatus.SCHEDULED,
            data: {
              selectedDateIndex: dto.selectedDateIndex,
              surgeryDate: new Date(dateOptions[dto.selectedDateIndex]),
            },
            userId,
          });
        assertTransitionApplied(applied);
      },
      { logger: this.logger, operationName: 'confirmDate' },
    );

    emitSurgeryRequestStatusChanged(this.eventEmitter, {
      surgeryRequestId: id,
      from: request.status,
      to: SurgeryRequestStatus.SCHEDULED,
      actorId: userId,
    });

    await this.notificationService.notifyStakeholdersOfStatusChange(
      request,
      SurgeryRequestStatus.IN_SCHEDULING,
      SurgeryRequestStatus.SCHEDULED,
      userId,
    );
  }

  async updateDateOptions(
    id: string,
    dto: UpdateDateOptionsDto,
    userId: string,
  ) {
    const request = await this.surgeryRequestRepository.findOneForWorkflow({
      id,
    });
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    this.stateMachine.assertStatus(
      request,
      SurgeryRequestStatus.IN_SCHEDULING,
      'A solicitação precisa estar Em Agendamento para atualizar datas.',
    );

    const applied = await this.surgeryRequestRepository.updateIfStatus(
      id,
      SurgeryRequestStatus.IN_SCHEDULING,
      { dateOptions: dto.dateOptions },
    );
    assertTransitionApplied(applied);

    emitSurgeryRequestUpdated(this.eventEmitter, {
      surgeryRequestId: id,
      actorId: userId,
    });

    if (dto.notifyPatient === true) {
      await this.notificationService.notifyPatientSchedulingOptions(
        request,
        dto.dateOptions,
      );
    }
  }

  async reschedule(id: string, dto: RescheduleDto, userId: string) {
    const request = await this.surgeryRequestRepository.findOneSimple({ id });
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    this.stateMachine.assertStatus(
      request,
      SurgeryRequestStatus.SCHEDULED,
      'A solicitação precisa estar Agendada para reagendar.',
    );

    const applied = await this.surgeryRequestRepository.updateIfStatus(
      id,
      SurgeryRequestStatus.SCHEDULED,
      { surgeryDate: new Date(dto.newDate) },
    );
    assertTransitionApplied(applied);

    emitSurgeryRequestUpdated(this.eventEmitter, {
      surgeryRequestId: id,
      actorId: userId,
    });
  }

  async registerPatientDateSelection(params: {
    from: string;
    phoneDigitCandidates: string[];
    selectedIndex: number;
  }): Promise<PatientDateSelectionResult> {
    const request = await this.resolveSelectionTarget(
      params.from,
      params.phoneDigitCandidates,
    );
    if (request === 'ambiguous') return { kind: 'ambiguous' };
    if (!request) return { kind: 'not_found' };

    const options = Array.isArray(request.dateOptions)
      ? request.dateOptions
      : [];
    const selectedIso = options[params.selectedIndex];
    if (!selectedIso) return { kind: 'invalid_option' };

    const applied = await this.surgeryRequestRepository.updateIfStatus(
      request.id,
      SurgeryRequestStatus.IN_SCHEDULING,
      { selectedDateIndex: params.selectedIndex },
    );
    if (!applied) return { kind: 'not_found' };

    await this.activityRepository.create({
      surgeryRequestId: request.id,
      userId: null,
      type: ActivityType.SYSTEM,
      content: `Paciente selecionou a ${params.selectedIndex + 1}ª opção de data (${formatSchedulingOption(selectedIso)}) no WhatsApp.`,
    });

    emitSurgeryRequestUpdated(this.eventEmitter, {
      surgeryRequestId: request.id,
      actorId: null,
    });

    return {
      kind: 'selected',
      request,
      selectedIndex: params.selectedIndex,
      selectedIso,
    };
  }

  private async resolveSelectionTarget(
    from: string,
    phoneDigitCandidates: string[],
  ): Promise<SurgeryRequest | 'ambiguous' | null> {
    const markedId = await this.selectionStore.find(from);
    if (markedId) {
      const [marked] =
        await this.surgeryRequestRepository.findInSchedulingByPatientPhones(
          phoneDigitCandidates,
          { id: markedId, limit: 1 },
        );
      if (marked) return marked;
    }

    const candidates =
      await this.surgeryRequestRepository.findInSchedulingByPatientPhones(
        phoneDigitCandidates,
        { limit: 2 },
      );
    if (candidates.length > 1) {
      this.logger.warn(
        `[registerPatientDateSelection] ${candidates.length}+ SCs em agendamento para o mesmo telefone sem marcador — escolha não registrada`,
      );
      return 'ambiguous';
    }
    return candidates[0] ?? null;
  }
}

export function formatSchedulingOption(isoDate: string | undefined): string {
  if (!isoDate) return '—';
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '—';

  const datePart = date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  });
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const timePart = minutes === '00' ? `${hours}h` : `${hours}:${minutes}h`;

  return `${datePart} às ${timePart}`;
}
