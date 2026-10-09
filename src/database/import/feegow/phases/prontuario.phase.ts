import { EntityManager } from 'typeorm';
import { ClinicalRecord } from 'src/database/entities/clinical-record.entity';
import { ClinicalRecordTemplate } from 'src/database/entities/clinical-record-template.entity';
import { ContextoImportacao } from '../context';
import { ExportFeegow } from '../export';
import {
  NovaFicha,
  NovoModeloAnamnese,
  planejarFichas,
  planejarModelosVazios,
} from '../mappers/clinical-record.mapper';
import { inserirEmLotes } from './inserir-em-lotes';

export interface PlanoProntuario {
  fichas: NovaFicha[];
  modelosVazios: NovoModeloAnamnese[];
}

export function planejarProntuario(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): PlanoProntuario {
  return {
    fichas: planejarFichas(exp, ctx),
    modelosVazios: planejarModelosVazios(exp, ctx),
  };
}

export async function gravarProntuario(
  plano: PlanoProntuario,
  manager: EntityManager,
): Promise<void> {
  await inserirEmLotes(manager, ClinicalRecord, plano.fichas, false, 50);
  await inserirEmLotes(manager, ClinicalRecordTemplate, plano.modelosVazios);
}
