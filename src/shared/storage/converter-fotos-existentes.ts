import { emParalelo } from '../../database/import/core/armazenamento';
import { nomeWebp, otimizarFotoPaciente } from './foto-paciente';

export interface FotoExistente {
  patientId: string;
  ownerId: string;
  photoPath: string;
}

export interface DependenciasConversao {
  baixar(caminho: string): Promise<Buffer | null>;
  enviar(conteudo: Buffer, nome: string, ownerId: string): Promise<string>;
  trocarCaminho(
    patientId: string,
    antigo: string,
    novo: string,
  ): Promise<boolean>;
  apagar(caminhos: string[]): Promise<string[]>;
}

export interface ResultadoConversao {
  convertidas: number;
  jaOtimizadas: number;
  falhas: { patientId: string; motivo: string }[];
  bytesAntes: number;
  bytesDepois: number;
}

export function conversaoSimulada(argv: readonly string[]): boolean {
  return !argv.includes('--aplicar');
}

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
      if (novo && !trocado) await apagar([novo]);
      falhou(
        foto.patientId,
        erro instanceof Error ? erro.message : String(erro),
      );
    }
  });

  return resultado;
}
