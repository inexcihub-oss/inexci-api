import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
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

@Injectable()
export class ClinicalRecordsService {
  constructor(
    private readonly clinicalRecordRepository: ClinicalRecordRepository,
    private readonly patientRepository: PatientRepository,
    private readonly appointmentRepository: AppointmentRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  /** Linha do tempo de atendimentos de um paciente. */
  async findByPatient(
    patientId: string,
    userId: string,
  ): Promise<ClinicalRecord[]> {
    const patient = await this.patientRepository.findOne({ id: patientId });
    if (!patient) throw new NotFoundException('Paciente não encontrado');
    await this.accessControlService.assertSameOwner(userId, patient.ownerId);

    auditProntuarioAccess({
      resource: 'clinical_record',
      resourceId: patientId,
      action: 'list',
      actorUserId: userId,
      tenantId: patient.ownerId,
    });

    return this.clinicalRecordRepository.findByPatientId(patientId);
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
    await this.accessControlService.assertSameOwner(userId, record.ownerId);
    return record;
  }

  async findOne(id: string, userId: string): Promise<ClinicalRecord> {
    const record = await this.clinicalRecordRepository.findOne({ id });
    if (!record) throw new NotFoundException('Atendimento não encontrado');
    await this.accessControlService.assertSameOwner(userId, record.ownerId);

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

    return (await this.clinicalRecordRepository.update(record.id, updateData))!;
  }

  /**
   * Finaliza o atendimento: torna a ficha imutável e marca a consulta vinculada
   * como realizada (se houver).
   */
  async finalize(id: string, userId: string): Promise<ClinicalRecord> {
    const record = await this.getEditable(id, userId);

    const finalized = (await this.clinicalRecordRepository.update(record.id, {
      finalizedAt: new Date(),
    }))!;

    if (record.appointmentId) {
      await this.appointmentRepository.update(record.appointmentId, {
        status: AppointmentStatus.COMPLETED,
      });
    }

    return finalized;
  }

  async delete(id: string, userId: string): Promise<void> {
    const record = await this.clinicalRecordRepository.findOne({ id });
    if (!record) throw new NotFoundException('Atendimento não encontrado');
    await this.accessControlService.assertSameOwner(userId, record.ownerId);
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
    await this.accessControlService.assertSameOwner(userId, record.ownerId);
    if (record.finalizedAt) {
      throw new BadRequestException(
        'Este atendimento foi finalizado e não pode mais ser editado.',
      );
    }
    return record;
  }

  private async assertAppointmentBelongs(
    appointmentId: string,
    ownerId: string,
    patientId: string,
  ): Promise<void> {
    const appointment = await this.appointmentRepository.findOne({
      id: appointmentId,
    });
    if (
      !appointment ||
      appointment.ownerId !== ownerId ||
      appointment.patientId !== patientId
    ) {
      throw new BadRequestException('Consulta inválida para este atendimento.');
    }
  }
}
