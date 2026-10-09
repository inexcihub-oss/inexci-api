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
import {
  ArmazenamentoImportacao,
  emParalelo,
  limparEPropagar,
} from '../../core/armazenamento';
import { Ledger } from '../../core/ledger';
import { Relatorio } from '../../core/report';
import { ContextoImportacao } from '../context';
import { ExportFeegow } from '../export';
import {
  LEDGER_DOCUMENTO,
  LEDGER_FOTO,
  NovaFoto,
  NovoAnexo,
  planejarAnexos,
} from '../mappers/document.mapper';
import { inserirEmLotes } from './inserir-em-lotes';

export interface PlanoAnexos {
  ownerId: string;
  documentos: NovoAnexo[];
  fotos: NovaFoto[];
  ledger: Ledger;
  relatorio: Relatorio;
  descartados: string[];
}

const UPLOADS_EM_PARALELO = 5;

export function planejarAnexosDaFase(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): PlanoAnexos {
  return {
    ownerId: ctx.ownerId,
    ...planejarAnexos(exp, ctx),
    ledger: ctx.ledger,
    relatorio: ctx.relatorio,
    descartados: [],
  };
}

class ArquivoIlegivel extends Error {}

export async function enviarAnexos(
  plano: PlanoAnexos,
  armazenamento: ArmazenamentoImportacao,
): Promise<string[]> {
  const enviados: string[] = [];
  const subir = async (
    arquivo: NovoAnexo['arquivo'],
    pasta: string,
  ): Promise<string> => {
    const foto = pasta === STORAGE_FOLDERS.PATIENT_PHOTOS;
    let conteudo: Buffer;
    try {
      const original = await readFile(arquivo.caminhoLocal);
      conteudo = foto ? await otimizarFotoPaciente(original) : original;
    } catch (erro) {
      throw new ArquivoIlegivel(
        `arquivo ilegível (${arquivo.nome}): ${(erro as Error).message}`,
      );
    }
    const caminho = await armazenamento.enviar({
      conteudo,
      pasta,
      nome: foto ? nomeWebp(arquivo.nome) : arquivo.nome,
      contentType: foto ? FOTO_PACIENTE_CONTENT_TYPE : arquivo.contentType,
      tenantId: plano.ownerId,
    });
    enviados.push(caminho);
    return caminho;
  };

  const docsRejeitados = new Set<NovoAnexo>();
  const fotosRejeitadas = new Set<NovaFoto>();
  try {
    await emParalelo(plano.documentos, UPLOADS_EM_PARALELO, async (d) => {
      try {
        d.uri = await subir(d.arquivo, STORAGE_FOLDERS.DOCUMENTS);
      } catch (erro) {
        if (!(erro instanceof ArquivoIlegivel)) throw erro;
        docsRejeitados.add(d);
        const idOrigem =
          plano.ledger.removerPorUuid(LEDGER_DOCUMENTO, d.id) ?? d.key;
        plano.relatorio.rejeitarAceito('anexo', idOrigem, erro.message);
      }
    });
    await emParalelo(plano.fotos, UPLOADS_EM_PARALELO, async (f) => {
      try {
        f.photoPath = await subir(f.arquivo, STORAGE_FOLDERS.PATIENT_PHOTOS);
      } catch (erro) {
        if (!(erro instanceof ArquivoIlegivel)) throw erro;
        fotosRejeitadas.add(f);
        const idOrigem =
          plano.ledger.removerPorUuid(LEDGER_FOTO, f.patientId) ?? f.patientId;
        plano.relatorio.rejeitarAceito('foto', idOrigem, erro.message);
      }
    });
  } catch (erro) {
    return limparEPropagar(erro, () => armazenamento.apagar(enviados));
  }
  plano.documentos = plano.documentos.filter((d) => !docsRejeitados.has(d));
  plano.fotos = plano.fotos.filter((f) => !fotosRejeitadas.has(f));
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
    const resultado = await manager.update(
      Patient,
      { id: f.patientId, photoPath: IsNull() },
      { photoPath: f.photoPath },
    );
    if (!resultado?.affected) {
      plano.descartados.push(f.photoPath!);
      const idOrigem =
        plano.ledger.removerPorUuid(LEDGER_FOTO, f.patientId) ?? f.patientId;
      plano.relatorio.desfazerAceite('foto');
      plano.relatorio.avisar(
        'foto',
        idOrigem,
        'paciente já tem foto na INEXCI: a do Feegow foi descartada',
      );
    }
  }
}

export function descartadosDosAnexos(plano: PlanoAnexos): string[] {
  return plano.descartados;
}
