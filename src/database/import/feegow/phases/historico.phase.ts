import { EntityManager } from 'typeorm';
import { AppointmentActivity } from 'src/database/entities/appointment-activity.entity';
import { ContextoImportacao } from '../context';
import { ExportFeegow } from '../export';
import {
  NovaAtividade,
  planejarHistorico as planejarAtividades,
} from '../mappers/activity.mapper';
import { inserirEmLotes } from './inserir-em-lotes';

export interface PlanoHistorico {
  atividades: NovaAtividade[];
}

export function planejarHistorico(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): PlanoHistorico {
  return { atividades: planejarAtividades(exp, ctx) };
}

export async function gravarHistorico(
  plano: PlanoHistorico,
  manager: EntityManager,
): Promise<void> {
  await inserirEmLotes(manager, AppointmentActivity, plano.atividades);
}
