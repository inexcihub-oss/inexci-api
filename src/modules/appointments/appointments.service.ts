import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentRepository } from 'src/database/repositories/appointment.repository';
import { PatientRepository } from 'src/database/repositories/patient.repository';
import {
  ClinicalRecordRepository,
  ClinicalRecordStatus,
} from 'src/database/repositories/clinical-record.repository';
import { ClinicRepository } from 'src/database/repositories/clinic.repository';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { UserRepository } from 'src/database/repositories/user.repository';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { formatAppointmentWhen, formatDoctorName } from 'src/shared/utils';
import {
  Appointment,
  AppointmentStatus,
  isActiveAppointmentStatus,
  OCCUPYING_APPOINTMENT_STATUSES,
  PG_EXCLUSION_VIOLATION,
} from 'src/database/entities/appointment.entity';
import { ClinicRoomRepository } from 'src/database/repositories/clinic-room.repository';
import { HealthPlanRepository } from 'src/database/repositories/health-plan.repository';
import { AppointmentActivityRepository } from 'src/database/repositories/appointment-activity.repository';
import {
  AppointmentActivity,
  AppointmentActivityType,
} from 'src/database/entities/appointment-activity.entity';
import { registrarNoHistorico } from './appointment-history';
import { AvailabilityService } from '../availability/availability.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { UpdateAppointmentStatusDto } from './dto/update-appointment-status.dto';
import {
  APPOINTMENTS_MAX_TAKE,
  FindAppointmentsDto,
} from './dto/find-appointments.dto';
import { errorMessage } from 'src/shared/utils/error-message.util';

export type AppointmentComFicha = Appointment & {
  clinicalRecordStatus: ClinicalRecordStatus | null;
};

const MENSAGEM_CONFLITO_DE_HORARIO =
  'Já existe uma consulta para este médico neste horário.';

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly appointmentRepository: AppointmentRepository,
    private readonly patientRepository: PatientRepository,
    private readonly clinicalRecordRepository: ClinicalRecordRepository,
    private readonly accessControlService: AccessControlService,
    private readonly clinicRepository: ClinicRepository,
    private readonly userRepository: UserRepository,
    private readonly whatsappService: WhatsappService,
    private readonly clinicRoomRepository: ClinicRoomRepository,
    private readonly healthPlanRepository: HealthPlanRepository,
    private readonly activityRepository: AppointmentActivityRepository,
    private readonly availabilityService: AvailabilityService,
  ) {}

  private registrar(
    appointmentId: string,
    userId: string,
    type: AppointmentActivityType,
    dados: {
      fromStatus?: string;
      toStatus?: string;
      content?: string | null;
    } = {},
  ): Promise<void> {
    return registrarNoHistorico(this.activityRepository, this.logger, {
      appointmentId,
      userId,
      type,
      ...dados,
    });
  }

  async findActivities(
    id: string,
    userId: string,
  ): Promise<AppointmentActivity[]> {
    await this.findOne(id, userId);
    return this.activityRepository.findByAppointment(id);
  }

  async addComment(
    id: string,
    content: string,
    userId: string,
  ): Promise<AppointmentActivity> {
    const texto = content?.trim();
    if (!texto) {
      throw new BadRequestException('Escreva o comentário.');
    }
    await this.findOne(id, userId);
    return this.activityRepository.create({
      appointmentId: id,
      userId,
      type: AppointmentActivityType.COMMENT,
      content: texto,
    });
  }

  private async assertSalaDaClinica(
    roomId: string,
    clinicId: string | null,
    ownerId: string,
  ): Promise<void> {
    const room = await this.clinicRoomRepository.findOne({ id: roomId });
    if (!room || room.ownerId !== ownerId) {
      throw new NotFoundException('Sala não encontrada');
    }
    if (!clinicId || room.clinicId !== clinicId) {
      throw new BadRequestException(
        'A sala precisa ser da clínica da consulta.',
      );
    }
    if (!room.active) {
      throw new BadRequestException('Esta sala está desativada.');
    }
  }

  private async assertConvenioDaConta(
    healthPlanId: string,
    ownerId: string,
  ): Promise<void> {
    const plan = await this.healthPlanRepository.findOne({ id: healthPlanId });
    if (!plan || plan.ownerId !== ownerId) {
      throw new NotFoundException('Convênio não encontrado');
    }
  }

  private endOf(start: Date, durationMinutes: number): Date {
    return new Date(start.getTime() + durationMinutes * 60_000);
  }

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

    const pedidos = [
      ...(query.doctorId ? [query.doctorId] : []),
      ...(query.doctorIds ?? []),
    ];
    const scopedDoctorIds = pedidos.length
      ? doctorIds.filter((id) => pedidos.includes(id))
      : doctorIds;

    const filtros = {
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      statuses: query.status,
    };

    const contagem = query.withDoctorCounts
      ? this.appointmentRepository.countByDoctor(ownerId, doctorIds, filtros)
      : Promise.resolve(undefined);

    const pagina = scopedDoctorIds.length
      ? this.appointmentRepository.findAgenda(ownerId, scopedDoctorIds, {
          ...filtros,
          order: query.order,
          skip: query.skip ?? 0,
          take: Math.min(
            query.take ?? APPOINTMENTS_MAX_TAKE,
            APPOINTMENTS_MAX_TAKE,
          ),
        })
      : Promise.resolve({ records: [], total: 0 });

    const [countByDoctorId, { records, total }] = await Promise.all([
      contagem,
      pagina,
    ]);

    return {
      total,
      records: await this.comSituacaoDaFicha(records),
      ...(countByDoctorId ? { countByDoctorId } : {}),
    };
  }

  async findByPatient(patientId: string, userId: string) {
    const [doctorIds, ownerId] = await Promise.all([
      this.accessControlService.getAccessibleDoctorIds(userId),
      this.accessControlService.getOwnerId(userId),
    ]);
    if (doctorIds.length === 0) return { total: 0, records: [] };

    const records = await this.comSituacaoDaFicha(
      await this.appointmentRepository.findByPatient(
        ownerId,
        doctorIds,
        patientId,
      ),
    );
    return { total: records.length, records };
  }

  async findOneComFicha(
    id: string,
    userId: string,
  ): Promise<AppointmentComFicha> {
    const [consulta] = await this.comSituacaoDaFicha([
      await this.findOne(id, userId),
    ]);
    return consulta;
  }

  private async comSituacaoDaFicha(
    consultas: Appointment[],
  ): Promise<AppointmentComFicha[]> {
    const situacao =
      await this.clinicalRecordRepository.findStatusByAppointmentIds(
        consultas.map((c) => c.id),
      );
    return consultas.map((c) =>
      Object.assign(c, { clinicalRecordStatus: situacao.get(c.id) ?? null }),
    );
  }

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
    if (data.roomId) {
      await this.assertSalaDaClinica(
        data.roomId,
        data.clinicId ?? null,
        ownerId,
      );
    }
    if (data.healthPlanId) {
      await this.assertConvenioDaConta(data.healthPlanId, ownerId);
    }

    const start = new Date(data.scheduledAt);
    const durationMinutes = data.durationMinutes ?? 30;
    const end = this.endOf(start, durationMinutes);
    const isWalkIn = data.isWalkIn ?? false;

    if (!isWalkIn) {
      await this.assertNoOverlap(data.doctorId, start, end);
    }
    await this.availabilityService.assertNaoBloqueado({
      ownerId,
      doctorId: data.doctorId,
      clinicId: data.clinicId ?? null,
      start,
      end,
    });

    const criada = await this.traduzirConflitoDeHorario(
      this.appointmentRepository.create({
        ownerId,
        doctorId: data.doctorId,
        patientId: data.patientId,
        clinicId: data.clinicId ?? null,
        roomId: data.roomId ?? null,
        isWalkIn,
        healthPlanId: data.healthPlanId ?? null,
        createdById: userId,
        type: data.type,
        scheduledAt: start,
        durationMinutes,
        notes: data.notes?.trim() || null,
        status: AppointmentStatus.SCHEDULED,
      }),
    );

    await this.registrar(criada.id, userId, AppointmentActivityType.CREATED, {
      toStatus: AppointmentStatus.SCHEDULED,
      content: `Consulta agendada para ${formatAppointmentWhen(start)}${isWalkIn ? ' (encaixe)' : ''}`,
    });

    await this.avisarPacienteDoAgendamento(
      patient,
      ownerId,
      data.doctorId,
      start,
    );

    return this.comAvisos(
      criada,
      data.doctorId,
      start,
      end,
      data.clinicId ?? null,
    );
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
    const isWalkIn = data.isWalkIn ?? appointment.isWalkIn;

    const ocupa = AppointmentsService.ocupaAgenda(appointment.status);

    const deixouDeSerEncaixe = appointment.isWalkIn && data.isWalkIn === false;
    if (
      ocupa &&
      !isWalkIn &&
      (data.scheduledAt !== undefined ||
        data.durationMinutes !== undefined ||
        deixouDeSerEncaixe)
    ) {
      await this.assertNoOverlap(
        appointment.doctorId,
        start,
        this.endOf(start, durationMinutes),
        id,
        { ignorarEncaixes: true },
      );
    }

    if (data.clinicId) {
      await this.assertClinicaDaConta(data.clinicId, appointment.ownerId);
    }
    const mudouHorario =
      data.scheduledAt !== undefined || data.durationMinutes !== undefined;
    const end = this.endOf(start, durationMinutes);
    if (ocupa && (mudouHorario || data.clinicId !== undefined)) {
      await this.availabilityService.assertNaoBloqueado({
        ownerId: appointment.ownerId,
        doctorId: appointment.doctorId,
        clinicId:
          data.clinicId !== undefined
            ? (data.clinicId ?? null)
            : appointment.clinicId,
        start,
        end,
      });
    }

    const updateData: Partial<Appointment> = {};
    if (data.type !== undefined) updateData.type = data.type;
    if (data.scheduledAt !== undefined) updateData.scheduledAt = start;
    if (data.durationMinutes !== undefined)
      updateData.durationMinutes = durationMinutes;
    if (data.notes !== undefined) updateData.notes = data.notes?.trim() || null;
    if (data.isWalkIn !== undefined) updateData.isWalkIn = data.isWalkIn;
    if (data.clinicId !== undefined)
      updateData.clinicId = data.clinicId ?? null;

    const clinicaFinal =
      data.clinicId !== undefined
        ? (data.clinicId ?? null)
        : appointment.clinicId;
    if (data.roomId !== undefined) {
      if (data.roomId) {
        await this.assertSalaDaClinica(
          data.roomId,
          clinicaFinal,
          appointment.ownerId,
        );
      }
      updateData.roomId = data.roomId ?? null;
    } else if (
      data.clinicId !== undefined &&
      clinicaFinal !== appointment.clinicId &&
      appointment.roomId
    ) {
      updateData.roomId = null;
    }

    if (data.healthPlanId !== undefined) {
      if (data.healthPlanId) {
        await this.assertConvenioDaConta(
          data.healthPlanId,
          appointment.ownerId,
        );
      }
      updateData.healthPlanId = data.healthPlanId ?? null;
    }

    const remarcou =
      data.scheduledAt !== undefined &&
      start.getTime() !== new Date(appointment.scheduledAt).getTime();
    if (remarcou) {
      updateData.reminderSentAt = null;
    }

    const atualizada = (await this.traduzirConflitoDeHorario(
      this.appointmentRepository.update(id, updateData),
    ))!;

    await this.registrarEdicao(appointment, updateData, userId);

    if (remarcou && isActiveAppointmentStatus(appointment.status)) {
      const patient = await this.patientRepository.findOne({
        id: appointment.patientId,
      });
      await this.avisarPacienteDoAgendamento(
        patient,
        appointment.ownerId,
        appointment.doctorId,
        start,
      );
    }

    return mudouHorario || data.clinicId !== undefined
      ? this.comAvisos(
          atualizada,
          appointment.doctorId,
          start,
          end,
          clinicaFinal,
        )
      : atualizada;
  }

  async updateStatus(
    id: string,
    data: UpdateAppointmentStatusDto,
    userId: string,
  ): Promise<Appointment> {
    const appointment = await this.findOne(id, userId);

    const saiDeRealizada =
      appointment.status === AppointmentStatus.COMPLETED &&
      data.status !== AppointmentStatus.COMPLETED;
    const viraNaoAtendida =
      appointment.status !== data.status &&
      (data.status === AppointmentStatus.CANCELLED ||
        data.status === AppointmentStatus.NO_SHOW);
    if (saiDeRealizada || viraNaoAtendida) {
      const record = await this.clinicalRecordRepository.findOne({
        appointmentId: id,
      });
      if (saiDeRealizada && record?.finalizedAt) {
        throw new ConflictException(
          'Esta consulta tem uma ficha de atendimento finalizada e não pode deixar de ser realizada.',
        );
      }
      if (viraNaoAtendida && record) {
        throw new ConflictException(
          data.status === AppointmentStatus.CANCELLED
            ? 'Esta consulta já tem uma ficha de atendimento e não pode ser cancelada.'
            : 'Esta consulta já tem uma ficha de atendimento e não pode ser marcada como falta.',
        );
      }
    }

    const voltaAOcupar =
      !AppointmentsService.ocupaAgenda(appointment.status) &&
      AppointmentsService.ocupaAgenda(data.status);

    if (voltaAOcupar && !appointment.isWalkIn) {
      await this.assertNoOverlap(
        appointment.doctorId,
        appointment.scheduledAt,
        this.endOf(appointment.scheduledAt, appointment.durationMinutes),
        id,
        { ignorarEncaixes: true },
      );
    }

    if (voltaAOcupar) {
      await this.availabilityService.assertNaoBloqueado({
        ownerId: appointment.ownerId,
        doctorId: appointment.doctorId,
        clinicId: appointment.clinicId,
        start: appointment.scheduledAt,
        end: this.endOf(appointment.scheduledAt, appointment.durationMinutes),
      });
    }

    const updateData: Partial<Appointment> = { status: data.status };
    updateData.cancellationReason =
      data.status === AppointmentStatus.CANCELLED
        ? data.cancellationReason?.trim() || null
        : null;

    const reativou =
      voltaAOcupar && AppointmentsService.isActiveStatus(data.status);
    if (reativou) {
      updateData.reminderSentAt = null;
    }

    const atualizada = (await this.traduzirConflitoDeHorario(
      this.appointmentRepository.update(id, updateData),
    ))!;

    if (appointment.status !== data.status) {
      await this.registrar(id, userId, AppointmentActivityType.STATUS_CHANGE, {
        fromStatus: appointment.status,
        toStatus: data.status,
        content: updateData.cancellationReason ?? null,
      });
    }

    if (
      data.status === AppointmentStatus.CANCELLED &&
      AppointmentsService.isActiveStatus(appointment.status)
    ) {
      await this.avisarPacienteDoCancelamento(appointment);
    }

    if (
      reativou &&
      (data.status === AppointmentStatus.SCHEDULED ||
        data.status === AppointmentStatus.CONFIRMED) &&
      new Date(appointment.scheduledAt).getTime() > Date.now()
    ) {
      const patient = await this.patientRepository.findOne({
        id: appointment.patientId,
      });
      await this.avisarPacienteDoAgendamento(
        patient,
        appointment.ownerId,
        appointment.doctorId,
        new Date(appointment.scheduledAt),
      );
    }

    return atualizada;
  }

  private async avisarPacienteDoAgendamento(
    patient: { name: string; phone: string | null } | null,
    ownerId: string,
    doctorId: string,
    scheduledAt: Date,
  ): Promise<void> {
    if (!patient?.phone) return;

    try {
      const habilitado = await this.userRepository.isPatientNotificationEnabled(
        ownerId,
        'appointmentScheduled',
      );
      if (!habilitado) return;

      const doctor = await this.userRepository.findOne({ id: doctorId });
      await this.whatsappService.sendAppointmentScheduled(patient.phone, {
        patientName: patient.name,
        doctorName: formatDoctorName(doctor?.name),
        when: formatAppointmentWhen(scheduledAt),
      });
    } catch (err) {
      this.logger.warn(
        `Falha ao avisar paciente do agendamento da consulta: ${errorMessage(err)}`,
      );
    }
  }

  private async avisarPacienteDoCancelamento(
    appointment: Appointment,
  ): Promise<void> {
    try {
      const habilitado = await this.userRepository.isPatientNotificationEnabled(
        appointment.ownerId,
        'appointmentCancelled',
      );
      if (!habilitado) return;

      const [patient, doctor] = await Promise.all([
        this.patientRepository.findOne({ id: appointment.patientId }),
        this.userRepository.findOne({ id: appointment.doctorId }),
      ]);
      if (!patient?.phone) return;

      await this.whatsappService.sendAppointmentCancelled(patient.phone, {
        patientName: patient.name,
        doctorName: formatDoctorName(doctor?.name),
        when: formatAppointmentWhen(appointment.scheduledAt),
      });
    } catch (err) {
      this.logger.warn(
        `Falha ao avisar paciente do cancelamento da consulta ${appointment.id}: ${errorMessage(err)}`,
      );
    }
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.findOne(id, userId);

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

  private async registrarEdicao(
    antes: Appointment,
    mudancas: Partial<Appointment>,
    userId: string,
  ): Promise<void> {
    const mudou = (campo: CampoComparavel) =>
      campo in mudancas &&
      String(mudancas[campo] ?? '') !== String(antes[campo] ?? '');

    const novoInicio = mudancas.scheduledAt;
    const remarcou =
      !!novoInicio &&
      new Date(novoInicio).getTime() !== new Date(antes.scheduledAt).getTime();
    if (remarcou || mudou('durationMinutes')) {
      const de = formatAppointmentWhen(new Date(antes.scheduledAt));
      const para = formatAppointmentWhen(
        new Date(novoInicio ?? antes.scheduledAt),
      );
      const duracao = mudou('durationMinutes')
        ? ` (${antes.durationMinutes} → ${mudancas.durationMinutes} min)`
        : '';
      await this.registrar(
        antes.id,
        userId,
        AppointmentActivityType.RESCHEDULED,
        {
          content: remarcou
            ? `De ${de} para ${para}${duracao}`
            : `Duração${duracao}`,
        },
      );
    }

    const rotulos: [CampoComparavel, string][] = [
      ['type', 'tipo'],
      ['clinicId', 'clínica'],
      ['roomId', 'sala'],
      ['healthPlanId', 'convênio'],
      ['isWalkIn', 'encaixe'],
      ['notes', 'observações'],
    ];
    const campos = rotulos.filter(([campo]) => mudou(campo)).map(([, r]) => r);
    if (campos.length) {
      await this.registrar(antes.id, userId, AppointmentActivityType.UPDATED, {
        content: `Alterou: ${campos.join(', ')}`,
      });
    }
  }

  private static isActiveStatus(status: AppointmentStatus): boolean {
    return isActiveAppointmentStatus(status);
  }

  private static ocupaAgenda(status: AppointmentStatus): boolean {
    return OCCUPYING_APPOINTMENT_STATUSES.includes(status);
  }

  private async traduzirConflitoDeHorario<T>(operacao: Promise<T>): Promise<T> {
    try {
      return await operacao;
    } catch (err) {
      const code = codigoDoErroDoBanco(err);
      if (code === PG_EXCLUSION_VIOLATION) {
        throw new ConflictException(MENSAGEM_CONFLITO_DE_HORARIO);
      }
      throw err;
    }
  }

  private async comAvisos(
    consulta: Appointment,
    doctorId: string,
    start: Date,
    end: Date,
    clinicId: string | null,
  ): Promise<Appointment & { warnings?: string[] }> {
    const fora = await this.availabilityService.foraDaGrade(
      doctorId,
      start,
      end,
      clinicId,
    );
    if (!fora) {
      return consulta;
    }
    return Object.assign(consulta, { warnings: ['fora_da_grade'] });
  }

  private async assertNoOverlap(
    doctorId: string,
    start: Date,
    end: Date,
    excludeId?: string,
    opcoes: { ignorarEncaixes?: boolean } = {},
  ): Promise<void> {
    const overlap = await this.appointmentRepository.hasOverlap(
      doctorId,
      start,
      end,
      excludeId,
      opcoes,
    );
    if (overlap) {
      throw new ConflictException(MENSAGEM_CONFLITO_DE_HORARIO);
    }
  }
}

function codigoDoErroDoBanco(err: unknown): unknown {
  if (typeof err !== 'object' || err === null) return undefined;
  const { code, driverError } = err as {
    code?: unknown;
    driverError?: { code?: unknown } | null;
  };
  return code ?? driverError?.code;
}

type CampoComparavel = keyof Pick<
  Appointment,
  | 'durationMinutes'
  | 'type'
  | 'clinicId'
  | 'roomId'
  | 'healthPlanId'
  | 'isWalkIn'
  | 'notes'
>;
