import { EntityManager } from 'typeorm';
import { DoctorSchedule } from 'src/database/entities/doctor-schedule.entity';
import { Holiday } from 'src/database/entities/holiday.entity';
import { ScheduleBlock } from 'src/database/entities/schedule-block.entity';
import { ContextoImportacao } from '../context';
import { ExportFeegow } from '../export';
import {
  NovaGrade,
  NovoBloqueio,
  NovoFeriado,
  planejarBloqueios,
  planejarFeriados,
  planejarGrades,
} from '../mappers/availability.mapper';
import { inserirEmLotes } from './inserir-em-lotes';

export interface PlanoDisponibilidade {
  grades: NovaGrade[];
  bloqueios: NovoBloqueio[];
  feriados: NovoFeriado[];
}

export function planejarDisponibilidade(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): PlanoDisponibilidade {
  return {
    grades: planejarGrades(exp, ctx),
    bloqueios: planejarBloqueios(exp, ctx),
    feriados: planejarFeriados(exp, ctx),
  };
}

export async function gravarDisponibilidade(
  plano: PlanoDisponibilidade,
  manager: EntityManager,
): Promise<void> {
  await inserirEmLotes(manager, DoctorSchedule, plano.grades);
  await inserirEmLotes(manager, ScheduleBlock, plano.bloqueios);
  await inserirEmLotes(manager, Holiday, plano.feriados);
}
