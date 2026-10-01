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
import { ClinicalRecordRepository } from 'src/database/repositories/clinical-record.repository';
import { ClinicRepository } from 'src/database/repositories/clinic.repository';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { UserRepository } from 'src/database/repositories/user.repository';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { formatAppointmentWhen, formatDoctorName } from 'src/shared/utils';
import {
  Appointment,
  AppointmentStatus,
  isActiveAppointmentStatus,
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

  /** Linha do tempo da consulta, com o mesmo recorte de acesso do `findOne`. */
  async findActivities(
    id: string,
    userId: string,
  ): Promise<AppointmentActivity[]> {
    await this.findOne(id, userId);
    return this.activityRepository.findByAppointment(id);
  }

  /** Comentário livre no histórico da consulta. */
  async addComment(
    id: string,
    content: string,
    userId: string,
  ): Promise<AppointmentActivity> {
    await this.findOne(id, userId);
    return this.activityRepository.create({
      appointmentId: id,
      userId,
      type: AppointmentActivityType.COMMENT,
      content: content.trim(),
    });
  }

  /**
   * Sala tem que ser da conta, da clínica da consulta e estar ativa. Consulta
   * sem clínica não tem sala. 404 pelo mesmo motivo da clínica.
   */
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

    // Encaixe é marcado de propósito em cima de outro horário.
    if (!isWalkIn) {
      await this.assertNoOverlap(data.doctorId, start, end);
    }
    // Bloqueio e feriado valem também para encaixe: o profissional não está.
    await this.availabilityService.assertNaoBloqueado({
      ownerId,
      doctorId: data.doctorId,
      clinicId: data.clinicId ?? null,
      start,
      end,
    });

    const criada = await this.appointmentRepository.create({
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
    });

    await this.registrar(criada.id, userId, AppointmentActivityType.CREATED, {
      toStatus: AppointmentStatus.SCHEDULED,
      content: `Consulta agendada para ${formatAppointmentWhen(start)}${isWalkIn ? ' (encaixe)' : ''}`,
    });

    // `patient` já veio da validação de conta acima — sem query extra.
    await this.avisarPacienteDoAgendamento(patient, data.doctorId, start);

    return this.comAvisos(criada, data.doctorId, start, end);
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

    // Só revalida conflito se o horário/duração mudou — ou se deixou de ser
    // encaixe, porque aí passa a disputar o horário como consulta normal.
    const deixouDeSerEncaixe = appointment.isWalkIn && data.isWalkIn === false;
    if (
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
      );
    }

    const mudouHorario =
      data.scheduledAt !== undefined || data.durationMinutes !== undefined;
    const end = this.endOf(start, durationMinutes);
    if (mudouHorario || data.clinicId !== undefined) {
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
    if (data.notes !== undefined) updateData.notes = data.notes.trim() || null;
    if (data.isWalkIn !== undefined) updateData.isWalkIn = data.isWalkIn;
    if (data.clinicId !== undefined) {
      if (data.clinicId) {
        await this.assertClinicaDaConta(data.clinicId, appointment.ownerId);
      }
      updateData.clinicId = data.clinicId ?? null;
    }

    // A sala segue a clínica: trocando a clínica sem mandar sala, a sala
    // antiga (de outra clínica) cai em vez de ficar inconsistente.
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
    } else if (data.clinicId !== undefined && appointment.roomId) {
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

    // Reagendou de fato: o lembrete já enviado era da data antiga, então a
    // marca de idempotência precisa cair — senão o paciente nunca é avisado do
    // novo horário. Reenviar o mesmo horário (ou mexer em notas/tipo) não zera.
    const remarcou =
      data.scheduledAt !== undefined &&
      start.getTime() !== new Date(appointment.scheduledAt).getTime();
    if (remarcou) {
      updateData.reminderSentAt = null;
    }

    const atualizada = (await this.appointmentRepository.update(
      id,
      updateData,
    ))!;

    await this.registrarEdicao(appointment, updateData, userId);

    if (remarcou) {
      const patient = await this.patientRepository.findOne({
        id: appointment.patientId,
      });
      await this.avisarPacienteDoAgendamento(
        patient,
        appointment.doctorId,
        start,
      );
    }

    return mudouHorario
      ? this.comAvisos(atualizada, appointment.doctorId, start, end)
      : atualizada;
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
      !appointment.isWalkIn &&
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

    // Voltar à agenda num dia que foi bloqueado enquanto a consulta estava
    // cancelada também é agendar num horário bloqueado.
    if (
      !AppointmentsService.isActiveStatus(appointment.status) &&
      AppointmentsService.isActiveStatus(data.status)
    ) {
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

    const atualizada = (await this.appointmentRepository.update(
      id,
      updateData,
    ))!;

    if (appointment.status !== data.status) {
      await this.registrar(id, userId, AppointmentActivityType.STATUS_CHANGE, {
        fromStatus: appointment.status,
        toStatus: data.status,
        content: updateData.cancellationReason ?? null,
      });
    }

    // Só o cancelamento vindo de um status ativo é novidade para o paciente:
    // recancelar uma consulta já cancelada repetiria o mesmo aviso.
    if (
      data.status === AppointmentStatus.CANCELLED &&
      AppointmentsService.isActiveStatus(appointment.status)
    ) {
      await this.avisarPacienteDoCancelamento(appointment);
    }

    return atualizada;
  }

  /**
   * Avisa o paciente que a consulta foi marcada — ou remarcada — para uma data.
   *
   * Best-effort: a consulta já está gravada, e uma falha de WhatsApp (ou um
   * paciente sem telefone) não pode desfazê-la nem devolver erro para a tela.
   */
  private async avisarPacienteDoAgendamento(
    patient: { name: string; phone: string | null } | null,
    doctorId: string,
    scheduledAt: Date,
  ): Promise<void> {
    if (!patient?.phone) return;

    try {
      const doctor = await this.userRepository.findOne({ id: doctorId });
      await this.whatsappService.sendAppointmentScheduled(patient.phone, {
        patientName: patient.name,
        doctorName: formatDoctorName(doctor?.name),
        when: formatAppointmentWhen(scheduledAt),
      });
    } catch (err: any) {
      this.logger.warn(
        `Falha ao avisar paciente do agendamento da consulta: ${err?.message}`,
      );
    }
  }

  /**
   * Avisa o paciente, pelo template aprovado, que a consulta foi cancelada.
   *
   * Best-effort de ponta a ponta: o cancelamento já está gravado, e uma falha
   * de WhatsApp (ou um paciente sem telefone) não pode desfazê-lo. O telefone
   * é buscado no cadastro porque a agenda só carrega id e nome do paciente.
   */
  private async avisarPacienteDoCancelamento(
    appointment: Appointment,
  ): Promise<void> {
    try {
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
    } catch (err: any) {
      this.logger.warn(
        `Falha ao avisar paciente do cancelamento da consulta ${appointment.id}: ${err?.message}`,
      );
    }
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

  /**
   * Remarcação (data ou duração mudou) vira uma linha própria, com o antes e o
   * depois; as demais mudanças viram uma linha "alterou: …" com os campos.
   * Reenviar o mesmo valor não registra nada.
   */
  private async registrarEdicao(
    antes: Appointment,
    mudancas: Partial<Appointment>,
    userId: string,
  ): Promise<void> {
    const mudou = <K extends keyof Appointment>(campo: K) =>
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

    const rotulos: [keyof Appointment, string][] = [
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

  /**
   * Status que ocupam a agenda do médico (contam para conflito de horário):
   * agendada, confirmada, aguardando e em atendimento.
   */
  private static isActiveStatus(status: AppointmentStatus): boolean {
    return isActiveAppointmentStatus(status);
  }

  /**
   * Fora da grade não é erro (como fora do horário da clínica): a consulta é
   * gravada e a resposta leva `warnings: ['fora_da_grade']` para a tela avisar.
   */
  private async comAvisos(
    consulta: Appointment,
    doctorId: string,
    start: Date,
    end: Date,
  ): Promise<Appointment & { warnings?: string[] }> {
    if (!(await this.availabilityService.foraDaGrade(doctorId, start, end))) {
      return consulta;
    }
    return Object.assign(consulta, { warnings: ['fora_da_grade'] });
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
