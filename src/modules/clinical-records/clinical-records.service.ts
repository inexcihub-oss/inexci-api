import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClinicalRecordRepository } from 'src/database/repositories/clinical-record.repository';
import { PatientRepository } from 'src/database/repositories/patient.repository';
import { AppointmentRepository } from 'src/database/repositories/appointment.repository';
import { ProcedureRepository } from 'src/database/repositories/procedure.repository';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { auditProntuarioAccess } from 'src/shared/logging/audit';
import { DataSource, IsNull } from 'typeorm';
import { ClinicalRecord } from 'src/database/entities/clinical-record.entity';
import {
  Appointment,
  AppointmentStatus,
  isActiveAppointmentStatus,
} from 'src/database/entities/appointment.entity';
import { CreateClinicalRecordDto } from './dto/create-clinical-record.dto';
import { UpdateClinicalRecordDto } from './dto/update-clinical-record.dto';
import { SurgicalIndicationService } from './surgical-indication/surgical-indication.service';
import { AppointmentActivityRepository } from 'src/database/repositories/appointment-activity.repository';
import { AppointmentActivityType } from 'src/database/entities/appointment-activity.entity';
import { registrarNoHistorico } from 'src/modules/appointments/appointment-history';

const ATENDIMENTO_INICIADO = 'Atendimento iniciado';

const MENSAGEM_INDICACAO =
  'Indicação cirúrgica só pode ser feita por médico (CRM).';
const MENSAGEM_INDICACAO_AO_FINALIZAR = `${MENSAGEM_INDICACAO} Desmarque a indicação cirúrgica para finalizar o atendimento.`;

const STATUS_ANTES_DO_ATENDIMENTO: readonly AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.WAITING,
];

@Injectable()
export class ClinicalRecordsService {
  private readonly logger = new Logger(ClinicalRecordsService.name);

  constructor(
    private readonly clinicalRecordRepository: ClinicalRecordRepository,
    private readonly patientRepository: PatientRepository,
    private readonly appointmentRepository: AppointmentRepository,
    private readonly accessControlService: AccessControlService,
    private readonly surgicalIndicationService: SurgicalIndicationService,
    private readonly appointmentActivityRepository: AppointmentActivityRepository,
    private readonly procedureRepository: ProcedureRepository,
    private readonly dataSource: DataSource,
  ) {}

  async findByPatient(
    patientId: string,
    userId: string,
  ): Promise<ClinicalRecord[]> {
    const patient = await this.patientRepository.findOne({ id: patientId });
    if (!patient) throw new NotFoundException('Paciente não encontrado');
    await this.accessControlService.assertSameOwner(userId, patient.ownerId);

    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);
    if (doctorIds.length === 0) return [];

    auditProntuarioAccess({
      resource: 'clinical_record',
      resourceId: patientId,
      action: 'list',
      actorUserId: userId,
      tenantId: patient.ownerId,
    });

    return this.clinicalRecordRepository.findByPatientId(
      patient.ownerId,
      doctorIds,
      patientId,
    );
  }

  async findByAppointment(
    appointmentId: string,
    userId: string,
  ): Promise<ClinicalRecord | null> {
    const record = await this.clinicalRecordRepository.findOne({
      appointmentId,
    });
    if (!record) return null;
    await this.assertCanAccessRecord(record, userId);
    return record;
  }

  async findOne(id: string, userId: string): Promise<ClinicalRecord> {
    const record = await this.clinicalRecordRepository.findOne({ id });
    if (!record) throw new NotFoundException('Atendimento não encontrado');
    await this.assertCanAccessRecord(record, userId);

    auditProntuarioAccess({
      resource: 'clinical_record',
      resourceId: id,
      action: 'read',
      actorUserId: userId,
      tenantId: record.ownerId,
    });

    return record;
  }

  async create(
    data: CreateClinicalRecordDto,
    userId: string,
  ): Promise<ClinicalRecord> {
    await this.accessControlService.assertIsDoctor(userId);
    const ownerId = await this.accessControlService.getOwnerId(userId);

    const patient = await this.patientRepository.findOne({
      id: data.patientId,
    });
    if (!patient || patient.ownerId !== ownerId) {
      throw new NotFoundException('Paciente não encontrado');
    }

    const doctorId =
      data.doctorId ??
      (await this.accessControlService.resolveDefaultDoctorId(userId));
    const canAccess = await this.accessControlService.canAccessDoctor(
      userId,
      doctorId,
    );
    if (!canAccess) {
      throw new ForbiddenException('Médico não acessível para esta operação.');
    }
    if (data.surgicalIndication) {
      await this.assertIndicacaoCirurgicaPermitida(doctorId, userId);
    }

    if (data.appointmentId) {
      await this.assertAppointmentBelongs(
        data.appointmentId,
        ownerId,
        data.patientId,
        doctorId,
      );

      const existing = await this.clinicalRecordRepository.findOne({
        appointmentId: data.appointmentId,
      });
      if (existing) {
        throw new ConflictException(
          'Esta consulta já possui uma ficha de atendimento.',
        );
      }
    }

    if (data.procedureId) {
      await this.assertProcedureBelongsToOwner(data.procedureId, ownerId);
    }

    const criada = await this.clinicalRecordRepository.create({
      ownerId,
      doctorId,
      patientId: data.patientId,
      appointmentId: data.appointmentId ?? null,
      anamnesis: data.anamnesis ?? null,
      physicalExam: data.physicalExam ?? null,
      diagnosis: data.diagnosis ?? null,
      cidCodes: data.cidCodes ?? null,
      conduct: data.conduct ?? null,
      surgicalIndication: data.surgicalIndication ?? false,
      procedureId: data.procedureId ?? null,
    });

    if (data.appointmentId) {
      await this.startLinkedAppointment(data.appointmentId, userId);
    }
    return criada;
  }

  private async startLinkedAppointment(
    appointmentId: string,
    userId: string,
  ): Promise<void> {
    const appointment = await this.appointmentRepository.findOne({
      id: appointmentId,
    });
    if (
      !appointment ||
      appointment.status === AppointmentStatus.IN_PROGRESS ||
      !isActiveAppointmentStatus(appointment.status)
    ) {
      return;
    }
    await this.appointmentRepository.update(appointmentId, {
      status: AppointmentStatus.IN_PROGRESS,
    });
    await registrarNoHistorico(
      this.appointmentActivityRepository,
      this.logger,
      {
        appointmentId,
        userId,
        type: AppointmentActivityType.STATUS_CHANGE,
        fromStatus: appointment.status,
        toStatus: AppointmentStatus.IN_PROGRESS,
        content: ATENDIMENTO_INICIADO,
      },
    );
  }

  async update(
    id: string,
    data: UpdateClinicalRecordDto,
    userId: string,
  ): Promise<ClinicalRecord> {
    const record = await this.getEditable(id, userId);

    const updateData: Partial<ClinicalRecord> = {};
    if (data.anamnesis !== undefined) updateData.anamnesis = data.anamnesis;
    if (data.physicalExam !== undefined)
      updateData.physicalExam = data.physicalExam;
    if (data.diagnosis !== undefined) updateData.diagnosis = data.diagnosis;
    if (data.cidCodes !== undefined) updateData.cidCodes = data.cidCodes;
    if (data.conduct !== undefined) updateData.conduct = data.conduct;
    if (data.surgicalIndication !== undefined)
      updateData.surgicalIndication = data.surgicalIndication;
    if (data.surgicalIndication === true && !record.surgicalIndication) {
      await this.assertIndicacaoCirurgicaPermitida(record.doctorId, userId);
    }
    if (data.procedureId !== undefined) {
      if (data.procedureId) {
        await this.assertProcedureBelongsToOwner(
          data.procedureId,
          record.ownerId,
        );
      }
      updateData.procedureId = data.procedureId;
    }

    return (await this.clinicalRecordRepository.update(record.id, updateData))!;
  }

  async finalize(id: string, userId: string): Promise<ClinicalRecord> {
    const record = await this.getEditable(id, userId);

    if (record.surgicalIndication) {
      await this.assertIndicacaoCirurgicaPermitida(record.doctorId, userId, {
        mensagem: MENSAGEM_INDICACAO_AO_FINALIZAR,
        acao: 'finalizar um atendimento com indicação cirúrgica',
      });
    }

    const appointment = record.appointmentId
      ? await this.findAppointmentToComplete(record.appointmentId)
      : null;

    await this.dataSource.transaction(async (manager) => {
      const result = await manager.getRepository(ClinicalRecord).update(
        { id: record.id, finalizedAt: IsNull() },
        {
          finalizedAt: new Date(),
        },
      );
      if (!result.affected) {
        throw new ConflictException('Este atendimento já foi finalizado.');
      }
      if (appointment) {
        await manager.getRepository(Appointment).update(appointment.id, {
          status: AppointmentStatus.COMPLETED,
        });
      }
    });

    if (appointment) {
      await registrarNoHistorico(
        this.appointmentActivityRepository,
        this.logger,
        {
          appointmentId: appointment.id,
          userId,
          type: AppointmentActivityType.STATUS_CHANGE,
          fromStatus: appointment.status,
          toStatus: AppointmentStatus.COMPLETED,
          content: 'Atendimento finalizado',
        },
      );
    }

    const finalized = (await this.clinicalRecordRepository.findOne({
      id: record.id,
    }))!;

    if (record.surgicalIndication) {
      try {
        const surgeryRequest =
          await this.surgicalIndicationService.createForRecord(
            record.id,
            userId,
          );
        if (surgeryRequest) {
          finalized.surgeryRequestId = surgeryRequest.id;
        }
      } catch (err) {
        this.logger.error(
          `Ficha ${record.id} finalizada, mas a SC falhou; o sweeper vai retomar: ${(err as Error)?.message}`,
        );
      }
    }

    return finalized;
  }

  private async findAppointmentToComplete(
    appointmentId: string,
  ): Promise<Appointment | null> {
    const appointment = await this.appointmentRepository.findOne({
      id: appointmentId,
    });
    if (!appointment) return null;

    if (!isActiveAppointmentStatus(appointment.status)) {
      this.logger.warn(
        `Ficha do atendimento finalizada com a consulta ${appointmentId} em "${appointment.status}"; status da agenda preservado.`,
      );
      return null;
    }
    return appointment;
  }

  private async assertIndicacaoCirurgicaPermitida(
    doctorId: string,
    userId: string,
    contexto: { mensagem: string; acao: string } = {
      mensagem: MENSAGEM_INDICACAO,
      acao: 'indicar cirurgia',
    },
  ): Promise<void> {
    await this.accessControlService.assertIsPhysicianWithRegistry(
      doctorId,
      contexto.mensagem,
      contexto.acao,
    );
    await this.assertQuemAgeEhMedico(doctorId, userId, contexto.mensagem);
  }

  private async assertQuemAgeEhMedico(
    doctorId: string,
    userId: string,
    mensagem: string,
  ): Promise<void> {
    if (userId === doctorId) return;
    await this.accessControlService.assertIsPhysician(userId, mensagem);
  }

  async delete(id: string, userId: string): Promise<void> {
    const record = await this.clinicalRecordRepository.findOne({ id });
    if (!record) throw new NotFoundException('Atendimento não encontrado');
    await this.assertCanWriteRecord(record, userId);
    if (record.finalizedAt) {
      throw new BadRequestException(
        'Um atendimento finalizado não pode ser excluído.',
      );
    }
    await this.clinicalRecordRepository.delete(id);

    if (record.appointmentId) {
      await this.undoLinkedAppointmentStart(record.appointmentId, userId);
    }
  }

  private async undoLinkedAppointmentStart(
    appointmentId: string,
    userId: string,
  ): Promise<void> {
    const appointment = await this.appointmentRepository.findOne({
      id: appointmentId,
    });
    if (appointment?.status !== AppointmentStatus.IN_PROGRESS) return;

    const mudancas = (
      await this.appointmentActivityRepository.findByAppointment(appointmentId)
    ).filter((a) => a.type === AppointmentActivityType.STATUS_CHANGE);
    const ultimaMudanca = mudancas[mudancas.length - 1];
    const anterior = ultimaMudanca?.fromStatus as AppointmentStatus | undefined;
    if (
      !ultimaMudanca ||
      ultimaMudanca.toStatus !== AppointmentStatus.IN_PROGRESS ||
      ultimaMudanca.content !== ATENDIMENTO_INICIADO ||
      !anterior ||
      !STATUS_ANTES_DO_ATENDIMENTO.includes(anterior)
    ) {
      return;
    }

    await this.appointmentRepository.update(appointmentId, {
      status: anterior,
    });
    await registrarNoHistorico(
      this.appointmentActivityRepository,
      this.logger,
      {
        appointmentId,
        userId,
        type: AppointmentActivityType.STATUS_CHANGE,
        fromStatus: AppointmentStatus.IN_PROGRESS,
        toStatus: anterior,
        content: 'Atendimento desfeito (rascunho da ficha excluído)',
      },
    );
  }

  private async getEditable(
    id: string,
    userId: string,
  ): Promise<ClinicalRecord> {
    const record = await this.clinicalRecordRepository.findOne({ id });
    if (!record) throw new NotFoundException('Atendimento não encontrado');
    await this.assertCanWriteRecord(record, userId);
    if (record.finalizedAt) {
      throw new BadRequestException(
        'Este atendimento foi finalizado e não pode mais ser editado.',
      );
    }
    return record;
  }

  private async assertCanWriteRecord(
    record: ClinicalRecord,
    userId: string,
  ): Promise<void> {
    await this.accessControlService.assertIsDoctor(userId);
    await this.assertCanAccessRecord(record, userId);
  }

  private async assertCanAccessRecord(
    record: ClinicalRecord,
    userId: string,
  ): Promise<void> {
    await this.accessControlService.assertCanAccessDoctorResource(
      userId,
      record.ownerId,
      record.doctorId,
    );
  }

  private async assertProcedureBelongsToOwner(
    procedureId: string,
    ownerId: string,
  ): Promise<void> {
    const procedure = await this.procedureRepository.findOne({
      id: procedureId,
    });
    if (!procedure || procedure.ownerId !== ownerId) {
      throw new NotFoundException('Procedimento não encontrado');
    }
  }

  private async assertAppointmentBelongs(
    appointmentId: string,
    ownerId: string,
    patientId: string,
    doctorId: string,
  ): Promise<void> {
    const appointment = await this.appointmentRepository.findOne({
      id: appointmentId,
    });
    if (
      !appointment ||
      appointment.ownerId !== ownerId ||
      appointment.patientId !== patientId ||
      appointment.doctorId !== doctorId
    ) {
      throw new BadRequestException('Consulta inválida para este atendimento.');
    }
  }
}
