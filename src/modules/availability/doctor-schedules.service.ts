import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DoctorSchedule } from 'src/database/entities/doctor-schedule.entity';
import { ClinicRepository } from 'src/database/repositories/clinic.repository';
import { ClinicRoomRepository } from 'src/database/repositories/clinic-room.repository';
import {
  DoctorScheduleRepository,
  DoctorScheduleTx,
} from 'src/database/repositories/doctor-schedule.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { Permission } from 'src/shared/permissions';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { horaParaMinutos } from './agenda-time';
import {
  CreateDoctorScheduleDto,
  UpdateDoctorScheduleDto,
} from './dto/doctor-schedule.dto';

/**
 * Grade de atendimento por profissional (MIG-05).
 *
 * Ler: quem acessa o profissional, ou quem tem Administração na conta (a
 * mesma regra de quem escreve — senão o admin delegado gravaria uma grade
 * que não consegue ler). Escrever: o próprio profissional na própria grade,
 * ou quem tem Administração na conta.
 *
 * Validar e gravar rodam numa transação travada por profissional
 * (`comTravaDoProfissional`), para a checagem de sobreposição não correr
 * contra outro POST simultâneo.
 */
@Injectable()
export class DoctorSchedulesService {
  constructor(
    private readonly scheduleRepository: DoctorScheduleRepository,
    private readonly clinicRepository: ClinicRepository,
    private readonly roomRepository: ClinicRoomRepository,
    private readonly userRepository: UserRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  async findByDoctor(
    doctorId: string,
    userId: string,
    permissions: readonly Permission[],
  ): Promise<DoctorSchedule[]> {
    const ownerId = await this.accessControlService.getOwnerId(userId);
    if (
      !(await this.accessControlService.canAccessDoctor(userId, doctorId)) &&
      !(
        permissions.includes(Permission.ADMINISTRACAO) &&
        (await this.profissionalDaConta(doctorId, ownerId))
      )
    ) {
      throw new ForbiddenException('Médico não acessível para esta operação.');
    }
    return this.scheduleRepository.findByDoctor(ownerId, doctorId);
  }

  async create(
    data: CreateDoctorScheduleDto,
    userId: string,
    permissions: readonly Permission[],
  ): Promise<DoctorSchedule> {
    const doctorId = data.doctorId ?? userId;
    const ownerId = await this.assertPodeEscrever(
      doctorId,
      userId,
      permissions,
    );
    const nova = {
      ownerId,
      doctorId,
      clinicId: data.clinicId ?? null,
      roomId: data.roomId ?? null,
      weekday: data.weekday,
      startTime: `${data.startTime}:00`,
      endTime: `${data.endTime}:00`,
      slotMinutes: data.slotMinutes ?? 30,
      maxWalkIns: data.maxWalkIns ?? null,
      validFrom: data.validFrom?.slice(0, 10) ?? null,
      validTo: data.validTo?.slice(0, 10) ?? null,
      active: data.active ?? true,
    };
    return this.scheduleRepository.comTravaDoProfissional(
      doctorId,
      async (tx) => {
        await this.validar(tx, nova, null, true);
        return tx.create(nova);
      },
    );
  }

  async update(
    id: string,
    data: UpdateDoctorScheduleDto,
    userId: string,
    permissions: readonly Permission[],
  ): Promise<DoctorSchedule> {
    const atual = await this.getOwned(id, userId);
    await this.assertPodeEscrever(atual.doctorId, userId, permissions);

    const mudancas: Partial<DoctorSchedule> = {};
    if (data.clinicId !== undefined) mudancas.clinicId = data.clinicId ?? null;
    if (data.roomId !== undefined) mudancas.roomId = data.roomId ?? null;
    // Trocar a clínica sem mandar sala tira a sala da clínica antiga.
    if (data.clinicId !== undefined && data.roomId === undefined)
      mudancas.roomId = null;
    if (data.weekday !== undefined) mudancas.weekday = data.weekday;
    if (data.startTime !== undefined)
      mudancas.startTime = `${data.startTime}:00`;
    if (data.endTime !== undefined) mudancas.endTime = `${data.endTime}:00`;
    if (data.slotMinutes !== undefined) mudancas.slotMinutes = data.slotMinutes;
    if (data.maxWalkIns !== undefined)
      mudancas.maxWalkIns = data.maxWalkIns ?? null;
    if (data.validFrom !== undefined)
      mudancas.validFrom = data.validFrom?.slice(0, 10) ?? null;
    if (data.validTo !== undefined)
      mudancas.validTo = data.validTo?.slice(0, 10) ?? null;
    if (data.active !== undefined) mudancas.active = data.active;

    // Clínica/sala só são reconferidas quando mudam ou quando o período volta
    // a valer: com a clínica ou a sala já removida, o período ainda pode ser
    // editado — inclusive desativado.
    const final = { ...atual, ...mudancas };
    const verificarLocal =
      data.clinicId !== undefined ||
      data.roomId !== undefined ||
      (final.active && !atual.active);
    return this.scheduleRepository.comTravaDoProfissional(
      atual.doctorId,
      async (tx) => {
        await this.validar(tx, final, id, verificarLocal);
        return (await tx.update(id, mudancas))!;
      },
    );
  }

  async delete(
    id: string,
    userId: string,
    permissions: readonly Permission[],
  ): Promise<void> {
    const atual = await this.getOwned(id, userId);
    await this.assertPodeEscrever(atual.doctorId, userId, permissions);
    await this.scheduleRepository.softDelete(id);
  }

  private async getOwned(id: string, userId: string): Promise<DoctorSchedule> {
    const grade = await this.scheduleRepository.findOne({ id });
    if (!grade) throw new NotFoundException('Grade não encontrada');
    await this.accessControlService.assertSameOwner(userId, grade.ownerId);
    return grade;
  }

  /** O usuário é profissional de saúde da conta `ownerId`? */
  private async profissionalDaConta(
    doctorId: string,
    ownerId: string,
  ): Promise<boolean> {
    const medico = await this.userRepository.findOneWithProfile({
      id: doctorId,
    });
    return !!medico?.doctorProfile && (medico.ownerId ?? medico.id) === ownerId;
  }

  /** Devolve o `ownerId` da conta. */
  private async assertPodeEscrever(
    doctorId: string,
    userId: string,
    permissions: readonly Permission[],
  ): Promise<string> {
    const ownerId = await this.accessControlService.getOwnerId(userId);
    const proprio = doctorId === userId;
    if (!proprio && !permissions.includes(Permission.ADMINISTRACAO)) {
      throw new ForbiddenException(
        'Só o próprio profissional ou a administração alteram a grade.',
      );
    }
    const medico = await this.userRepository.findOneWithProfile({
      id: doctorId,
    });
    if (!medico?.doctorProfile) {
      throw new BadRequestException('A grade é de um profissional de saúde.');
    }
    if ((medico.ownerId ?? medico.id) !== ownerId) {
      throw new ForbiddenException('Profissional de outra conta.');
    }
    return ownerId;
  }

  /**
   * Horário coerente, clínica/sala da conta (só com `verificarLocal`) e sem
   * sobreposição na vigência. Roda dentro da transação travada.
   */
  private async validar(
    tx: DoctorScheduleTx,
    g: Pick<
      DoctorSchedule,
      | 'ownerId'
      | 'doctorId'
      | 'clinicId'
      | 'roomId'
      | 'weekday'
      | 'startTime'
      | 'endTime'
      | 'slotMinutes'
      | 'validFrom'
      | 'validTo'
      | 'active'
    >,
    ignorarId: string | null,
    verificarLocal: boolean,
  ): Promise<void> {
    const ini = horaParaMinutos(g.startTime);
    const fim = horaParaMinutos(g.endTime);
    if (ini >= fim) {
      throw new BadRequestException('O início deve ser antes do fim.');
    }
    if (fim - ini < g.slotMinutes) {
      throw new BadRequestException('O período não comporta nenhum horário.');
    }
    if (g.validFrom && g.validTo && g.validFrom > g.validTo) {
      throw new BadRequestException('A vigência termina antes de começar.');
    }
    if (verificarLocal && g.clinicId) {
      const clinica = await this.clinicRepository.findOne({ id: g.clinicId });
      if (!clinica || clinica.ownerId !== g.ownerId) {
        throw new BadRequestException('Clínica não encontrada.');
      }
    }
    if (verificarLocal && g.roomId) {
      const sala = await this.roomRepository.findOne({ id: g.roomId });
      if (!sala || sala.ownerId !== g.ownerId || sala.clinicId !== g.clinicId) {
        throw new BadRequestException(
          'A sala não pertence à clínica da grade.',
        );
      }
      if (!sala.active) {
        throw new BadRequestException('A sala está desativada.');
      }
    }
    if (!g.active) return;

    const conflito = (await tx.findActiveByDoctor(g.doctorId)).find(
      (o) =>
        o.id !== ignorarId &&
        o.weekday === g.weekday &&
        horaParaMinutos(o.startTime) < fim &&
        ini < horaParaMinutos(o.endTime) &&
        (!o.validTo || !g.validFrom || g.validFrom <= o.validTo) &&
        (!g.validTo || !o.validFrom || o.validFrom <= g.validTo),
    );
    if (conflito) {
      throw new ConflictException(
        `Já existe um período de ${conflito.startTime.slice(0, 5)} às ${conflito.endTime.slice(0, 5)} nesse dia.`,
      );
    }
  }
}
