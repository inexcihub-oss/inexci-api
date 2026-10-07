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
  apagar(caminhos: string[]): Promise<void>;
}

export interface ResultadoConversao {
  convertidas: number;
  jaOtimizadas: number;
  falhas: { patientId: string; motivo: string }[];
  bytesAntes: number;
  bytesDepois: number;
}

/**
 * Converte as fotos de paciente já gravadas para o formato otimizado (WebP de
 * até 800 px). Uma por vez por foto, 5 em paralelo. A original só é apagada
 * depois que o paciente passou a apontar para a nova; se a troca não
 * acontecer, quem é apagada é a nova. Com `simular`, só mede.
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
  const antigasParaApagar: string[] = [];

  await emParalelo(fotos, 5, async (foto) => {
    if (foto.photoPath.toLowerCase().endsWith('.webp')) {
      resultado.jaOtimizadas++;
      return;
    }
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
      const novo = await deps.enviar(otimizada, nome, foto.ownerId);
      if (await deps.trocarCaminho(foto.patientId, foto.photoPath, novo)) {
        antigasParaApagar.push(foto.photoPath);
        resultado.convertidas++;
      } else {
        await deps.apagar([novo]);
        resultado.falhas.push({
          patientId: foto.patientId,
          motivo: 'foto trocada durante a conversão (mantida a atual)',
        });
      }
    } catch (erro) {
      resultado.falhas.push({
        patientId: foto.patientId,
        motivo: erro instanceof Error ? erro.message : String(erro),
      });
    }
  });

  if (antigasParaApagar.length) await deps.apagar(antigasParaApagar);
  return resultado;
}
