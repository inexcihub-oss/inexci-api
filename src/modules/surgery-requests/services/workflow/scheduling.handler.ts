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
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { executeInTransaction } from 'src/shared/utils/transaction.util';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';

import { SurgeryRequestNotificationService } from '../surgery-request-notification.service';
import { ConfirmDateDto } from '../../dto/confirm-date.dto';
import { UpdateDateOptionsDto } from '../../dto/update-date-options.dto';
import { RescheduleDto } from '../../dto/reschedule.dto';

@Injectable()
export class SchedulingHandler {
  private readonly logger = new Logger(SchedulingHandler.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly notificationService: SurgeryRequestNotificationService,
  ) {}

  async confirmDate(id: string, dto: ConfirmDateDto, userId: string) {
    this.logger.log(`[confirmDate] Confirmando data da solicitação ${id}`);
    const request = await this.surgeryRequestRepository.findOneWithAllRelations(
      { id },
    );
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    if (request.status !== SurgeryRequestStatus.IN_SCHEDULING) {
      throw new BadRequestException(
        'A solicitação precisa estar Em Agendamento.',
      );
    }

    const dateOptions = request.dateOptions as string[];
    if (!dateOptions || dateOptions[dto.selectedDateIndex] === undefined) {
      throw new BadRequestException(ERROR_MESSAGES.INVALID_DATE_INDEX);
    }

    await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const repo = manager.getRepository(SurgeryRequest);
        await repo.update(
          { id },
          {
            status: SurgeryRequestStatus.SCHEDULED,
            selectedDateIndex: dto.selectedDateIndex,
            surgeryDate: new Date(dateOptions[dto.selectedDateIndex]),
          },
        );
        await this.surgeryRequestRepository.recordStatusChange(
          manager,
          id,
          request.status,
          SurgeryRequestStatus.SCHEDULED,
          userId,
        );
      },
      { logger: this.logger, operationName: 'confirmDate' },
    );

    await this.notificationService.notifyPatientIfRequested(
      request,
      request.status,
      SurgeryRequestStatus.SCHEDULED,
      dto.notify_patient,
    );

    await this.notificationService.notifyAdminsOfWorkflowAction(
      userId,
      request.patient?.name ?? 'Paciente',
      request.protocol ?? id,
      'Data de cirurgia confirmada',
      `/solicitacao/${id}`,
    );

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
    _userId: string,
  ) {
    const request = await this.surgeryRequestRepository.findOneSimple({ id });
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    if (request.status !== SurgeryRequestStatus.IN_SCHEDULING) {
      throw new BadRequestException(
        'A solicitação precisa estar Em Agendamento para atualizar datas.',
      );
    }

    await this.surgeryRequestRepository.update(id, {
      dateOptions: dto.dateOptions,
    });
  }

  async reschedule(id: string, dto: RescheduleDto, _userId: string) {
    const request = await this.surgeryRequestRepository.findOneSimple({ id });
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    if (request.status !== SurgeryRequestStatus.SCHEDULED) {
      throw new BadRequestException(
        'A solicitação precisa estar Agendada para reagendar.',
      );
    }

    await this.surgeryRequestRepository.update(id, {
      surgeryDate: new Date(dto.new_date),
    });
  }
}
