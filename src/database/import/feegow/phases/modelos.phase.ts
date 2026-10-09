import { EntityManager } from 'typeorm';
import { ClinicalDocumentTemplate } from 'src/database/entities/clinical-document-template.entity';
import { ContextoImportacao } from '../context';
import { ExportFeegow } from '../export';
import {
  NovoModeloDocumento,
  planejarModelosDeDocumento,
} from '../mappers/doc-template.mapper';
import { inserirEmLotes } from './inserir-em-lotes';

export interface PlanoModelos {
  modelos: NovoModeloDocumento[];
}

export function planejarModelos(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): PlanoModelos {
  return { modelos: planejarModelosDeDocumento(exp, ctx) };
}

export async function gravarModelos(
  plano: PlanoModelos,
  manager: EntityManager,
): Promise<void> {
  await inserirEmLotes(manager, ClinicalDocumentTemplate, plano.modelos);
}
