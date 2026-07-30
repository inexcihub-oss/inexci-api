import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentRepository } from 'src/database/repositories/appointment.repository';
import { PatientRepository } from 'src/database/repositories/patient.repository';
import { AccessControlService } from 'src/shared/services/access-control.service';
import {
  Appointment,
  AppointmentStatus,
} from 'src/database/entities/appointment.entity';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { UpdateAppointmentStatusDto } from './dto/update-appointment-status.dto';
import {
  APPOINTMENTS_MAX_TAKE,
  FindAppointmentsDto,
} from './dto/find-appointments.dto';

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly appointmentRepository: AppointmentRepository,
    private readonly patientRepository: PatientRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  /** Fim da consulta = início + duração. */
  private endOf(start: Date, durationMinutes: number): Date {
    return new Date(start.getTime() + durationMinutes * 60_000);
  }

  async findAgenda(query: FindAppointmentsDto, userId: string) {
    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);
    if (doctorIds.length === 0) return { total: 0, records: [] };

    // Filtro por médico: só é aplicado se o médico for acessível (fail-closed).
    const scopedDoctorIds =
      query.doctorId && doctorIds.includes(query.doctorId)
        ? [query.doctorId]
        : doctorIds;

    const records = await this.appointmentRepository.findAgenda(
      scopedDoctorIds,
      new Date(query.from),
      new Date(query.to),
      APPOINTMENTS_MAX_TAKE,
    );

    return { total: records.length, records };
  }

  /** Histórico completo de consultas de um paciente (aba Consultas / timeline). */
  async findByPatient(patientId: string, userId: string) {
    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);
    if (doctorIds.length === 0) return { total: 0, records: [] };

    const records = await this.appointmentRepository.findByPatient(
      doctorIds,
      patientId,
    );
    return { total: records.length, records };
  }

  async findOne(id: string, userId: string): Promise<Appointment> {
    const appointment = await this.appointmentRepository.findOne({ id });
    if (!appointment) throw new NotFoundException('Consulta não encontrada');
    await this.accessControlService.assertSameOwner(
      userId,
      appointment.ownerId,
    );
    return appointment;
  }

  async create(
    data: CreateAppointmentDto,
    userId: string,
  ): Promise<Appointment> {
    const ownerId = await this.accessControlService.getOwnerId(userId);

    const canAccess = await this.accessControlService.canAccessDoctor(
      userId,
      data.doctorId,
    );
    if (!canAccess) {
      throw new ForbiddenException('Médico não acessível para esta operação.');
    }

    const patient = await this.patientRepository.findOne({ id: data.patientId });
    if (!patient || patient.ownerId !== ownerId) {
      throw new NotFoundException('Paciente não encontrado');
    }

    const start = new Date(data.scheduledAt);
    const durationMinutes = data.durationMinutes ?? 30;
    const end = this.endOf(start, durationMinutes);

    await this.assertNoOverlap(data.doctorId, start, end);

    return this.appointmentRepository.create({
      ownerId,
      doctorId: data.doctorId,
      patientId: data.patientId,
      type: data.type,
      scheduledAt: start,
      durationMinutes,
      notes: data.notes?.trim() || null,
      status: AppointmentStatus.SCHEDULED,
    });
  }

  async update(
    id: string,
    data: UpdateAppointmentDto,
    userId: string,
  ): Promise<Appointment> {
    const appointment = await this.findOne(id, userId);

    const start = data.scheduledAt
      ? new Date(data.scheduledAt)
      : appointment.scheduledAt;
    const durationMinutes = data.durationMinutes ?? appointment.durationMinutes;

    // Só revalida conflito se o horário/duração mudou.
    if (data.scheduledAt !== undefined || data.durationMinutes !== undefined) {
      await this.assertNoOverlap(
        appointment.doctorId,
        start,
        this.endOf(start, durationMinutes),
        id,
      );
    }

    const updateData: Partial<Appointment> = {};
    if (data.type !== undefined) updateData.type = data.type;
    if (data.scheduledAt !== undefined) updateData.scheduledAt = start;
    if (data.durationMinutes !== undefined)
      updateData.durationMinutes = durationMinutes;
    if (data.notes !== undefined) updateData.notes = data.notes.trim() || null;

    return (await this.appointmentRepository.update(id, updateData))!;
  }

  async updateStatus(
    id: string,
    data: UpdateAppointmentStatusDto,
    userId: string,
  ): Promise<Appointment> {
    await this.findOne(id, userId);

    const updateData: Partial<Appointment> = { status: data.status };
    updateData.cancellationReason =
      data.status === AppointmentStatus.CANCELLED
        ? data.cancellationReason?.trim() || null
        : null;

    return (await this.appointmentRepository.update(id, updateData))!;
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.findOne(id, userId);
    await this.appointmentRepository.delete(id);
  }

  private async assertNoOverlap(
    doctorId: string,
    start: Date,
    end: Date,
    excludeId?: string,
  ): Promise<void> {
    const overlap = await this.appointmentRepository.hasOverlap(
      doctorId,
      start,
      end,
      excludeId,
    );
    if (overlap) {
      throw new ConflictException(
        'Já existe uma consulta para este médico neste horário.',
      );
    }
  }
}
