import { emParalelo } from '../../database/import/core/armazenamento';
import { nomeWebp, otimizarFotoPaciente } from './foto-paciente';

export interface FotoExistente {
  patientId: string;
  ownerId: string;
  photoPath: string;
}

export interface DependenciasConversao {
  baixar(caminho: string): Promise<Buffer | null>;
  /** Sobe a foto otimizada e devolve o caminho novo. */
  enviar(conteudo: Buffer, nome: string, ownerId: string): Promise<string>;
  /**
   * Troca o caminho no paciente só se ele ainda aponta para o antigo (alguém
   * pode ter trocado a foto pela tela no meio da conversão).
   */
  trocarCaminho(
    patientId: string,
    antigo: string,
    novo: string,
  ): Promise<boolean>;
  /**
   * Apaga os objetos e devolve as chaves que NÃO foram apagadas (vazio =
   * tudo certo). Não deve lançar; se lançar, todas contam como não apagadas.
   */
  apagar(caminhos: string[]): Promise<string[]>;
}

export interface ResultadoConversao {
  convertidas: number;
  jaOtimizadas: number;
  falhas: { patientId: string; motivo: string }[];
  bytesAntes: number;
  bytesDepois: number;
}

/**
 * Argumentos do script `otimizar-fotos-pacientes`: simulação é o padrão, e só
 * `--aplicar` grava/apaga. Um `--simular` sobrando (o opt-in antigo) não muda
 * nada; um typo em `--aplicar` também cai na simulação, nunca no destrutivo.
 */
export function conversaoSimulada(argv: readonly string[]): boolean {
  return !argv.includes('--aplicar');
}

/**
 * Converte as fotos de paciente já gravadas para o formato otimizado (WebP de
 * até 800 px), 5 em paralelo. Para cada foto, nesta ordem:
 *
 *  1. sobe a nova;
 *  2. troca o caminho no paciente (só se ainda aponta para a antiga);
 *  3. apaga a original logo em seguida — não no fim do lote: se o processo
 *     cair no meio, no máximo as fotos em voo ficam para trás, e não a conta
 *     inteira de originais (dado de paciente) sem nenhum registro apontando.
 *
 * Se a troca não acontecer (ou o UPDATE lançar), quem é apagada é a nova. Se a
 * original não puder ser apagada, a foto entra em `falhas` com o caminho —
 * o paciente já aponta para a nova, então uma nova rodada a pularia e o
 * relatório é o único rastro do objeto que sobrou. Com `simular`, só mede.
 */
export async function converterFotosExistentes(
  fotos: FotoExistente[],
  deps: DependenciasConversao,
  simular = false,
): Promise<ResultadoConversao> {
  const resultado: ResultadoConversao = {
    convertidas: 0,
    jaOtimizadas: 0,
    falhas: [],
    bytesAntes: 0,
    bytesDepois: 0,
  };
  const falhou = (patientId: string, motivo: string) =>
    resultado.falhas.push({ patientId, motivo });

  /** Apaga e devolve o que sobrou; exceção conta como nada apagado. */
  const apagar = async (caminhos: string[]): Promise<string[]> => {
    try {
      return await deps.apagar(caminhos);
    } catch {
      return caminhos;
    }
  };

  await emParalelo(fotos, 5, async (foto) => {
    if (foto.photoPath.toLowerCase().endsWith('.webp')) {
      resultado.jaOtimizadas++;
      return;
    }
    let novo: string | undefined;
    let trocado = false;
    try {
      const original = await deps.baixar(foto.photoPath);
      if (!original) throw new Error('arquivo não encontrado no bucket');
      const otimizada = await otimizarFotoPaciente(original);
      resultado.bytesAntes += original.length;
      resultado.bytesDepois += otimizada.length;
      if (simular) {
        resultado.convertidas++;
        return;
      }
      const nome = nomeWebp(foto.photoPath.split('/').pop() ?? 'foto');
      novo = await deps.enviar(otimizada, nome, foto.ownerId);
      trocado = await deps.trocarCaminho(foto.patientId, foto.photoPath, novo);
      if (!trocado) {
        await apagar([novo]);
        falhou(
          foto.patientId,
          'foto trocada durante a conversão (mantida a atual)',
        );
        return;
      }
      const sobraram = await apagar([foto.photoPath]);
      if (sobraram.length) {
        falhou(
          foto.patientId,
          `convertida, mas a original não foi apagada do bucket: ${foto.photoPath}`,
        );
        return;
      }
      resultado.convertidas++;
    } catch (erro) {
      // Subiu a nova mas o UPDATE falhou: a nova não é de ninguém.
      if (novo && !trocado) await apagar([novo]);
      falhou(
        foto.patientId,
        erro instanceof Error ? erro.message : String(erro),
      );
    }
  });

  return resultado;
}
