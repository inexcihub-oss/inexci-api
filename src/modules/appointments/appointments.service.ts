import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentRepository } from 'src/database/repositories/appointment.repository';
import { PatientRepository } from 'src/database/repositories/patient.repository';
import { ClinicalRecordRepository } from 'src/database/repositories/clinical-record.repository';
import { ClinicRepository } from 'src/database/repositories/clinic.repository';
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
    private readonly clinicalRecordRepository: ClinicalRecordRepository,
    private readonly accessControlService: AccessControlService,
    private readonly clinicRepository: ClinicRepository,
  ) {}

  /** Fim da consulta = início + duração. */
  private endOf(start: Date, durationMinutes: number): Date {
    return new Date(start.getTime() + durationMinutes * 60_000);
  }

  /**
   * Valida que a clínica escolhida é da mesma conta. 404 (e não 403) pelo
   * mesmo motivo do paciente: não confirmar a existência de id de outra conta.
   */
  private async assertClinicaDaConta(
    clinicId: string,
    ownerId: string,
  ): Promise<void> {
    const clinic = await this.clinicRepository.findOne({ id: clinicId });
    if (!clinic || clinic.ownerId !== ownerId) {
      throw new NotFoundException('Clínica não encontrada');
    }
  }

  async findAgenda(query: FindAppointmentsDto, userId: string) {
    const [doctorIds, ownerId] = await Promise.all([
      this.accessControlService.getAccessibleDoctorIds(userId),
      this.accessControlService.getOwnerId(userId),
    ]);
    if (doctorIds.length === 0) return { total: 0, records: [] };

    // Filtro por médico fail-closed: um `doctorId` fora do conjunto acessível
    // devolve lista vazia, nunca a agenda inteira. Ignorar o filtro em silêncio
    // fazia a tela responder "as consultas do médico X" mostrando as de todos.
    // Lista vazia (e não 403) também evita enumerar ids de médicos.
    if (query.doctorId && !doctorIds.includes(query.doctorId)) {
      return { total: 0, records: [] };
    }
    const scopedDoctorIds = query.doctorId ? [query.doctorId] : doctorIds;

    // `total` é a contagem real no banco, não o tamanho da página: quando o
    // teto de `APPOINTMENTS_MAX_TAKE` corta a lista, `total > records.length`
    // é o único sinal que o consumidor tem de que faltou coisa. Devolver
    // `records.length` fazia o teto se disfarçar de total.
    const { records, total } = await this.appointmentRepository.findAgenda(
      ownerId,
      scopedDoctorIds,
      {
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        statuses: query.status,
        order: query.order,
        take: APPOINTMENTS_MAX_TAKE,
      },
    );

    return { total, records };
  }

  /** Histórico completo de consultas de um paciente (aba Consultas / timeline). */
  async findByPatient(patientId: string, userId: string) {
    const [doctorIds, ownerId] = await Promise.all([
      this.accessControlService.getAccessibleDoctorIds(userId),
      this.accessControlService.getOwnerId(userId),
    ]);
    if (doctorIds.length === 0) return { total: 0, records: [] };

    const records = await this.appointmentRepository.findByPatient(
      ownerId,
      doctorIds,
      patientId,
    );
    return { total: records.length, records };
  }

  /**
   * Consulta por id. Escopa por clínica **e** por médico acessível: sem o
   * segundo recorte, um colaborador vinculado só ao médico A leria, reagendaria,
   * cancelaria ou excluiria a agenda do médico B — o mesmo recorte que
   * `findAgenda`/`findByPatient` e `create` já aplicam.
   */
  async findOne(id: string, userId: string): Promise<Appointment> {
    const appointment = await this.appointmentRepository.findOneComRelacoes(id);
    if (!appointment) throw new NotFoundException('Consulta não encontrada');
    await this.accessControlService.assertCanAccessDoctorResource(
      userId,
      appointment.ownerId,
      appointment.doctorId,
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

    const patient = await this.patientRepository.findOne({
      id: data.patientId,
    });
    if (!patient || patient.ownerId !== ownerId) {
      throw new NotFoundException('Paciente não encontrado');
    }

    if (data.clinicId) {
      await this.assertClinicaDaConta(data.clinicId, ownerId);
    }

    const start = new Date(data.scheduledAt);
    const durationMinutes = data.durationMinutes ?? 30;
    const end = this.endOf(start, durationMinutes);

    await this.assertNoOverlap(data.doctorId, start, end);

    return this.appointmentRepository.create({
      ownerId,
      doctorId: data.doctorId,
      patientId: data.patientId,
      clinicId: data.clinicId ?? null,
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
    if (data.clinicId !== undefined) {
      if (data.clinicId) {
        const ownerId = await this.accessControlService.getOwnerId(userId);
        await this.assertClinicaDaConta(data.clinicId, ownerId);
      }
      updateData.clinicId = data.clinicId ?? null;
    }

    // Reagendou de fato: o lembrete já enviado era da data antiga, então a
    // marca de idempotência precisa cair — senão o paciente nunca é avisado do
    // novo horário. Reenviar o mesmo horário (ou mexer em notas/tipo) não zera.
    if (
      data.scheduledAt !== undefined &&
      start.getTime() !== new Date(appointment.scheduledAt).getTime()
    ) {
      updateData.reminderSentAt = null;
    }

    return (await this.appointmentRepository.update(id, updateData))!;
  }

  async updateStatus(
    id: string,
    data: UpdateAppointmentStatusDto,
    userId: string,
  ): Promise<Appointment> {
    const appointment = await this.findOne(id, userId);

    // Reativar (cancelada/falta → agendada/confirmada) devolve a consulta à
    // agenda, e o horário pode ter sido ocupado enquanto ela estava fora: sem
    // revalidar, ficavam duas consultas ativas do mesmo médico no mesmo slot.
    // Transições entre status ativos (→ realizada) ou saídas da agenda
    // (→ cancelada/falta) não passam por aqui.
    if (
      !AppointmentsService.isActiveStatus(appointment.status) &&
      AppointmentsService.isActiveStatus(data.status)
    ) {
      await this.assertNoOverlap(
        appointment.doctorId,
        appointment.scheduledAt,
        this.endOf(appointment.scheduledAt, appointment.durationMinutes),
        id,
      );
    }

    const updateData: Partial<Appointment> = { status: data.status };
    updateData.cancellationReason =
      data.status === AppointmentStatus.CANCELLED
        ? data.cancellationReason?.trim() || null
        : null;

    return (await this.appointmentRepository.update(id, updateData))!;
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.findOne(id, userId);

    // Dado clínico não pode ficar órfão: a ficha aponta para a consulta, e sem
    // a consulta a tela `/atendimento/[appointmentId]` não abre mais — o
    // rascunho continuaria na timeline do paciente, inalcançável pela UI.
    const record = await this.clinicalRecordRepository.findOne({
      appointmentId: id,
    });
    if (record) {
      throw new ConflictException(
        'Esta consulta possui uma ficha de atendimento e não pode ser excluída.',
      );
    }

    await this.appointmentRepository.delete(id);
  }

  /** Status que ocupam a agenda do médico (contam para conflito de horário). */
  private static isActiveStatus(status: AppointmentStatus): boolean {
    return (
      status === AppointmentStatus.SCHEDULED ||
      status === AppointmentStatus.CONFIRMED
    );
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
