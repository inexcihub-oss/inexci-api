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
  /**
   * Ledger de trabalho e relatório da fase: o item que não entrar (arquivo
   * ilegível no upload, paciente que já tinha foto) sai dos dois.
   */
  ledger: Ledger;
  relatorio: Relatorio;
  /**
   * Arquivos que subiram mas a gravação não usou — o runner apaga depois do
   * COMMIT (`descartadosDosAnexos`).
   */
  descartados: string[];
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
  return {
    ownerId: ctx.ownerId,
    ...planejarAnexos(exp, ctx),
    ledger: ctx.ledger,
    relatorio: ctx.relatorio,
    descartados: [],
  };
}

/** Arquivo do export que não deu para ler/converter: rejeita só ele. */
class ArquivoIlegivel extends Error {}

/**
 * Sobe os arquivos e preenche `uri`/`photoPath` no plano. Devolve tudo o que
 * subiu. Arquivo local ilegível (foto corrompida, formato que o `sharp` não
 * abre) é rejeitado no relatório e sai do plano e do ledger, sem derrubar a
 * fase; falha de upload derruba, e o que já tinha subido é apagado.
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
    // Foto de paciente entra já otimizada, como no upload pela tela (WebP de
    // até 800 px): as do Feegow são PNG de ~500 KB e caem para ~15 KB.
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
    await armazenamento.apagar(enviados);
    throw erro;
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
    // Não sobrescreve foto que alguém já pôs pela tela.
    const resultado = await manager.update(
      Patient,
      { id: f.patientId, photoPath: IsNull() },
      { photoPath: f.photoPath },
    );
    if (!resultado?.affected) {
      // A foto subiu mas não foi usada: sai do ledger (não conta como
      // importada) e o arquivo é apagado pelo runner depois do COMMIT.
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

/** Uploads que a gravação descartou; o runner apaga depois do COMMIT. */
export function descartadosDosAnexos(plano: PlanoAnexos): string[] {
  return plano.descartados;
}
