import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { DoctorSchedule } from 'src/database/entities/doctor-schedule.entity';
import { Holiday } from 'src/database/entities/holiday.entity';
import { ScheduleBlock } from 'src/database/entities/schedule-block.entity';
import { AppointmentRepository } from 'src/database/repositories/appointment.repository';
import { DoctorScheduleRepository } from 'src/database/repositories/doctor-schedule.repository';
import { HolidayRepository } from 'src/database/repositories/holiday.repository';
import { ScheduleBlockRepository } from 'src/database/repositories/schedule-block.repository';
import { AccessControlService } from 'src/shared/services/access-control.service';
import {
  dataLocal,
  datasEntre,
  diaDaSemana,
  horaParaMinutos,
  instanteLocal,
  minutosLocais,
  vigente,
} from './agenda-time';
import { FindSlotsDto } from './dto/find-slots.dto';

/** Janela máxima de `GET /availability/slots`. */
export const SLOTS_MAX_DIAS = 31;

export type MotivoOcupado = 'appointment' | 'block' | 'holiday';

export interface Slot {
  start: string;
  end: string;
  free: boolean;
  reason?: MotivoOcupado;
}

export interface DiaDisponivel {
  date: string;
  /** Feriado do dia (bloqueando a agenda ou não). */
  holiday: { name: string; blocksAgenda: boolean } | null;
  slots: Slot[];
}

/** Feriado que cai na data: no dia exato ou, se recorrente, no mesmo dia/mês. */
export function feriadoDoDia(
  feriados: Holiday[],
  data: string,
): Holiday | undefined {
  return feriados.find(
    (h) =>
      h.date === data || (h.recurring && h.date.slice(5) === data.slice(5)),
  );
}

/** Bloqueio vale para a consulta: mesmo profissional (ou clínica toda) e clínica compatível. */
export function bloqueioAtinge(
  b: ScheduleBlock,
  doctorId: string,
  clinicId: string | null,
): boolean {
  if (b.doctorId && b.doctorId !== doctorId) return false;
  return !b.clinicId || !clinicId || b.clinicId === clinicId;
}

const sobrepoe = (aIni: number, aFim: number, bIni: number, bFim: number) =>
  aIni < bFim && bIni < aFim;

/**
 * Disponibilidade da agenda (MIG-05): expande a grade em horários, marca o
 * que está ocupado, e diz se um horário está bloqueado ou fora da grade.
 *
 * Contas que não configuram nada (sem grade, bloqueio ou feriado) continuam
 * como antes: nada é bloqueado e nada fica "fora da grade".
 */
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly scheduleRepository: DoctorScheduleRepository,
    private readonly blockRepository: ScheduleBlockRepository,
    private readonly holidayRepository: HolidayRepository,
    private readonly appointmentRepository: AppointmentRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  async getSlots(
    query: FindSlotsDto,
    userId: string,
  ): Promise<DiaDisponivel[]> {
    const from = query.from.slice(0, 10);
    const to = query.to.slice(0, 10);
    const datas = datasEntre(from, to);
    if (!datas.length) throw new BadRequestException('Intervalo inválido.');
    if (datas.length > SLOTS_MAX_DIAS) {
      throw new BadRequestException(
        `Consulte no máximo ${SLOTS_MAX_DIAS} dias por vez.`,
      );
    }
    if (
      !(await this.accessControlService.canAccessDoctor(userId, query.doctorId))
    ) {
      throw new ForbiddenException('Médico não acessível para esta operação.');
    }
    const ownerId = await this.accessControlService.getOwnerId(userId);

    const inicio = instanteLocal(from, '00:00');
    const fim = instanteLocal(datas[datas.length - 1], '23:59:59');
    const [grades, bloqueios, feriados, consultas] = await Promise.all([
      this.scheduleRepository.findActiveByDoctor(query.doctorId),
      this.blockRepository.findInRange(ownerId, inicio, fim, [query.doctorId]),
      this.holidayRepository.findByOwner(ownerId),
      this.appointmentRepository.findOcupando(query.doctorId, inicio, fim),
    ]);

    return datas.map((data) =>
      this.diaDisponivel(
        data,
        query.doctorId,
        grades,
        bloqueios,
        feriados,
        consultas,
      ),
    );
  }

  private diaDisponivel(
    data: string,
    doctorId: string,
    grades: DoctorSchedule[],
    bloqueios: ScheduleBlock[],
    feriados: Holiday[],
    consultas: { scheduledAt: Date; durationMinutes: number }[],
  ): DiaDisponivel {
    const feriado = feriadoDoDia(feriados, data);
    const semana = diaDaSemana(data);
    const slots: Slot[] = [];
    for (const g of grades) {
      if (g.weekday !== semana || !vigente(data, g.validFrom, g.validTo))
        continue;
      const fimGrade = horaParaMinutos(g.endTime);
      for (
        let m = horaParaMinutos(g.startTime);
        m + g.slotMinutes <= fimGrade;
        m += g.slotMinutes
      ) {
        const ini = instanteLocal(data, minutosParaHora(m));
        const fimSlot = new Date(ini.getTime() + g.slotMinutes * 60_000);
        let reason: MotivoOcupado | undefined;
        if (feriado?.blocksAgenda) reason = 'holiday';
        else if (
          bloqueios.some(
            (b) =>
              bloqueioAtinge(b, doctorId, g.clinicId) &&
              sobrepoe(
                ini.getTime(),
                fimSlot.getTime(),
                b.startsAt.getTime(),
                b.endsAt.getTime(),
              ),
          )
        )
          reason = 'block';
        else if (
          consultas.some((c) => {
            const cIni = new Date(c.scheduledAt).getTime();
            return sobrepoe(
              ini.getTime(),
              fimSlot.getTime(),
              cIni,
              cIni + c.durationMinutes * 60_000,
            );
          })
        )
          reason = 'appointment';
        slots.push({
          start: ini.toISOString(),
          end: fimSlot.toISOString(),
          free: !reason,
          ...(reason ? { reason } : {}),
        });
      }
    }
    slots.sort((a, b) => a.start.localeCompare(b.start));
    return {
      date: data,
      holiday: feriado
        ? { name: feriado.name, blocksAgenda: feriado.blocksAgenda }
        : null,
      slots,
    };
  }

  /**
   * Bloqueio ou feriado que bloqueia a agenda no intervalo → 409. Vale também
   * para encaixe: bloqueio é ausência do profissional, não disputa de horário.
   */
  async assertNaoBloqueado(params: {
    ownerId: string;
    doctorId: string;
    clinicId: string | null;
    start: Date;
    end: Date;
  }): Promise<void> {
    const { ownerId, doctorId, clinicId, start, end } = params;
    const feriados = await this.holidayRepository.findByOwner(ownerId);
    for (const data of datasEntre(
      dataLocal(start),
      dataLocal(new Date(end.getTime() - 1)),
    )) {
      const feriado = feriadoDoDia(feriados, data);
      if (feriado?.blocksAgenda) {
        throw new ConflictException(
          `Horário bloqueado na agenda do profissional: feriado (${feriado.name}).`,
        );
      }
    }
    const bloqueio = (
      await this.blockRepository.findInRange(ownerId, start, end, [doctorId])
    ).find((b) => bloqueioAtinge(b, doctorId, clinicId));
    if (bloqueio) {
      throw new ConflictException(
        `Horário bloqueado na agenda do profissional: ${bloqueio.reason?.trim() || 'bloqueio de agenda'}.`,
      );
    }
  }

  /**
   * O horário cai fora da grade do profissional? Só responde `true` quando o
   * profissional **tem** grade configurada: sem grade, nada está "fora".
   */
  async foraDaGrade(
    doctorId: string,
    start: Date,
    end: Date,
  ): Promise<boolean> {
    const grades = await this.scheduleRepository.findActiveByDoctor(doctorId);
    if (!grades.length) return false;
    const data = dataLocal(start);
    if (dataLocal(new Date(end.getTime() - 1)) !== data) return true;
    const ini = minutosLocais(start);
    const fim = ini + Math.round((end.getTime() - start.getTime()) / 60_000);
    return !grades.some(
      (g) =>
        g.weekday === diaDaSemana(data) &&
        vigente(data, g.validFrom, g.validTo) &&
        ini >= horaParaMinutos(g.startTime) &&
        fim <= horaParaMinutos(g.endTime),
    );
  }
}

export function minutosParaHora(minutos: number): string {
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}
