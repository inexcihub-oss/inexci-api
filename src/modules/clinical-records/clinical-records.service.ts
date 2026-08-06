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
import { AccessControlService } from 'src/shared/services/access-control.service';
import { auditProntuarioAccess } from 'src/shared/logging/audit';
import { ClinicalRecord } from 'src/database/entities/clinical-record.entity';
import { AppointmentStatus } from 'src/database/entities/appointment.entity';
import { CreateClinicalRecordDto } from './dto/create-clinical-record.dto';
import { UpdateClinicalRecordDto } from './dto/update-clinical-record.dto';
import { SurgicalIndicationService } from './surgical-indication/surgical-indication.service';

@Injectable()
export class ClinicalRecordsService {
  private readonly logger = new Logger(ClinicalRecordsService.name);

  constructor(
    private readonly clinicalRecordRepository: ClinicalRecordRepository,
    private readonly patientRepository: PatientRepository,
    private readonly appointmentRepository: AppointmentRepository,
    private readonly accessControlService: AccessControlService,
    private readonly surgicalIndicationService: SurgicalIndicationService,
  ) {}

  /**
   * Linha do tempo de atendimentos de um paciente.
   *
   * O paciente é visível para toda a clínica, mas a ficha não: só entram os
   * atendimentos dos médicos que o usuário acessa (`user_doctor_access`).
   */
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

  /** Ficha em aberto vinculada a uma consulta (para retomar o atendimento). */
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

    if (data.appointmentId) {
      await this.assertAppointmentBelongs(
        data.appointmentId,
        ownerId,
        data.patientId,
        doctorId,
      );

      // Duas abas abertas na mesma consulta, ou uma retentativa depois de uma
      // resposta perdida, criariam prontuários duplicados — e
      // `findByAppointment` devolveria só um deles, deixando o outro órfão.
      // O banco também barra (índice único parcial), mas aqui o erro é claro.
      const existing = await this.clinicalRecordRepository.findOne({
        appointmentId: data.appointmentId,
      });
      if (existing) {
        throw new ConflictException(
          'Esta consulta já possui uma ficha de atendimento.',
        );
      }
    }

    return this.clinicalRecordRepository.create({
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
    });
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

    return (await this.clinicalRecordRepository.update(record.id, updateData))!;
  }

  /**
   * Finaliza o atendimento: torna a ficha imutável, marca a consulta vinculada
   * como realizada (se houver) e, quando o paciente foi marcado como cirúrgico,
   * cria a solicitação cirúrgica em Pendente.
   */
  async finalize(id: string, userId: string): Promise<ClinicalRecord> {
    const record = await this.getEditable(id, userId);

    const finalized = (await this.clinicalRecordRepository.update(record.id, {
      finalizedAt: new Date(),
    }))!;

    if (record.appointmentId) {
      await this.completeLinkedAppointment(record.appointmentId);
    }

    if (record.surgicalIndication) {
      // Best-effort de propósito: a ficha já está finalizada e é imutável, então
      // falhar aqui não pode derrubar a resposta. A própria ficha (indicação sem
      // SC) é o registro pendente que o sweeper retoma.
      try {
        const surgeryRequest =
          await this.surgicalIndicationService.createForRecord(
            record.id,
            userId,
          );
        if (surgeryRequest) {
          finalized.surgeryRequestId = surgeryRequest.id;
        }
      } catch (err: any) {
        this.logger.error(
          `Ficha ${record.id} finalizada, mas a SC falhou; o sweeper vai retomar: ${err?.message}`,
        );
      }
    }

    return finalized;
  }

  /**
   * Promove a consulta vinculada para "realizada" — mas só se ela ainda estava
   * na agenda (agendada/confirmada).
   *
   * Uma consulta cancelada ou marcada como falta já saiu da agenda e carrega o
   * motivo do cancelamento; promovê-la produzia o estado inconsistente
   * "realizada com motivo de cancelamento". A finalização da ficha em si não
   * depende disso e segue adiante — o registro clínico do médico vale mesmo
   * quando o status da agenda ficou para trás.
   */
  private async completeLinkedAppointment(appointmentId: string) {
    const appointment = await this.appointmentRepository.findOne({
      id: appointmentId,
    });
    if (!appointment) return;

    const isActive =
      appointment.status === AppointmentStatus.SCHEDULED ||
      appointment.status === AppointmentStatus.CONFIRMED;

    if (!isActive) {
      this.logger.warn(
        `Ficha do atendimento finalizada com a consulta ${appointmentId} em "${appointment.status}"; status da agenda preservado.`,
      );
      return;
    }

    await this.appointmentRepository.update(appointmentId, {
      status: AppointmentStatus.COMPLETED,
    });
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
  }

  /** Retorna a ficha garantindo acesso e que ainda esteja editável. */
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

  /**
   * Escrever na ficha exige, além do acesso de leitura, ser médico.
   *
   * Secretária e assistente participam do atendimento (agendam, cadastram,
   * anexam exames) e leem o prontuário dos médicos a que têm vínculo — mas a
   * ficha é o registro clínico assinado pelo médico da consulta, e finalizá-la
   * ainda dispara a solicitação cirúrgica em nome dele.
   */
  private async assertCanWriteRecord(
    record: ClinicalRecord,
    userId: string,
  ): Promise<void> {
    await this.accessControlService.assertIsDoctor(userId);
    await this.assertCanAccessRecord(record, userId);
  }

  /**
   * Recorte de acesso da ficha: clínica **e** médico acessível.
   *
   * Só o `ownerId` não basta — quem não tem vínculo com o médico da ficha não
   * pode ler a anamnese, reescrevê-la, marcá-la como cirúrgica, finalizá-la
   * (o que cria uma SC em nome daquele médico) nem excluí-la. É o mesmo recorte
   * que `create` já exigia e que o módulo de solicitações aplica nas rotas
   * por id.
   */
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

  private async assertAppointmentBelongs(
    appointmentId: string,
    ownerId: string,
    patientId: string,
    doctorId: string,
  ): Promise<void> {
    const appointment = await this.appointmentRepository.findOne({
      id: appointmentId,
    });
    // O médico da consulta precisa ser o mesmo da ficha: sem isso, a ficha de
    // um médico acessível serviria de porta para escrever na consulta de um
    // médico que o usuário não acessa.
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
