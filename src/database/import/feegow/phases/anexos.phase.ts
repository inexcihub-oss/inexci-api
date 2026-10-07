import { readFile } from 'fs/promises';
import { EntityManager, IsNull } from 'typeorm';
import { STORAGE_FOLDERS } from 'src/config/storage.config';
import {
  FOTO_PACIENTE_CONTENT_TYPE,
  nomeWebp,
  otimizarFotoPaciente,
} from 'src/shared/storage/foto-paciente';
import { Document } from 'src/database/entities/document.entity';
import { Patient } from 'src/database/entities/patient.entity';
import { ArmazenamentoImportacao, emParalelo } from '../../core/armazenamento';
import { ContextoImportacao } from '../context';
import { ExportFeegow } from '../export';
import {
  NovaFoto,
  NovoAnexo,
  planejarAnexos,
} from '../mappers/document.mapper';
import { inserirEmLotes } from './inserir-em-lotes';

export interface PlanoAnexos {
  ownerId: string;
  documentos: NovoAnexo[];
  fotos: NovaFoto[];
}

/** Uploads simultâneos: as fotos somam centenas de MB. */
const UPLOADS_EM_PARALELO = 5;

/**
 * Fase `anexos`: PDFs do paciente e fotos de perfil. A única que sai do
 * banco: os arquivos sobem antes da transação (`enviarAnexos`) e, se a
 * gravação falhar, o runner apaga o que subiu.
 */
export function planejarAnexosDaFase(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): PlanoAnexos {
  return { ownerId: ctx.ownerId, ...planejarAnexos(exp, ctx) };
}

/**
 * Sobe os arquivos e preenche `uri`/`photoPath` no plano. Devolve tudo o que
 * subiu — também quando falha no meio (`erro.enviados`), para o rollback.
 */
export async function enviarAnexos(
  plano: PlanoAnexos,
  armazenamento: ArmazenamentoImportacao,
): Promise<string[]> {
  const enviados: string[] = [];
  const subir = async (
    arquivo: NovoAnexo['arquivo'],
    pasta: string,
  ): Promise<string> => {
    const original = await readFile(arquivo.caminhoLocal);
    // Foto de paciente entra já otimizada, como no upload pela tela (WebP de
    // até 800 px): as do Feegow são PNG de ~500 KB e caem para ~15 KB.
    const foto = pasta === STORAGE_FOLDERS.PATIENT_PHOTOS;
    const caminho = await armazenamento.enviar({
      conteudo: foto ? await otimizarFotoPaciente(original) : original,
      pasta,
      nome: foto ? nomeWebp(arquivo.nome) : arquivo.nome,
      contentType: foto ? FOTO_PACIENTE_CONTENT_TYPE : arquivo.contentType,
      tenantId: plano.ownerId,
    });
    enviados.push(caminho);
    return caminho;
  };
  try {
    await emParalelo(plano.documentos, UPLOADS_EM_PARALELO, async (d) => {
      d.uri = await subir(d.arquivo, STORAGE_FOLDERS.DOCUMENTS);
    });
    await emParalelo(plano.fotos, UPLOADS_EM_PARALELO, async (f) => {
      f.photoPath = await subir(f.arquivo, STORAGE_FOLDERS.PATIENT_PHOTOS);
    });
  } catch (erro) {
    await armazenamento.apagar(enviados);
    throw erro;
  }
  return enviados;
}

export async function gravarAnexos(
  plano: PlanoAnexos,
  manager: EntityManager,
): Promise<void> {
  if (
    plano.documentos.some((d) => !d.uri) ||
    plano.fotos.some((f) => !f.photoPath)
  ) {
    throw new Error('Anexos sem upload: rode enviarAnexos antes de gravar.');
  }
  await inserirEmLotes(
    manager,
    Document,
    plano.documentos.map(({ arquivo: _arquivo, ...doc }) => doc),
  );
  for (const f of plano.fotos) {
    // Não sobrescreve foto que alguém já pôs pela tela.
    await manager.update(
      Patient,
      { id: f.patientId, photoPath: IsNull() },
      { photoPath: f.photoPath },
    );
  }
}
