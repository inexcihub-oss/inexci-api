import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Patient } from 'src/database/entities/patient.entity';
import { StorageService } from 'src/shared/storage/storage.service';
import { STORAGE_FOLDERS } from 'src/config/storage.config';

/**
 * Janela de segurança: só é apagado o objeto enviado há mais que isso. Cobre o
 * intervalo entre o upload e o cadastro/PATCH que o referencia (o modal de
 * novo paciente sobe a foto antes do `POST /patients` e guarda o caminho para
 * a próxima tentativa) e a importação/conversão de fotos, que sobem o arquivo
 * e só depois gravam o `photo_path`.
 */
export const FOTO_ORFA_JANELA_HORAS = 24;

/** Teto de chaves por consulta/remoção (o `DeleteObjects` do S3 aceita 1000). */
const LOTE = 1000;

/**
 * Remove de `patient-photos/` os objetos que nenhum paciente referencia —
 * fotos de dado de saúde (LGPD) que ficaram para trás quando o upload deu
 * certo mas o passo seguinte não: o `PATCH` da troca de foto falhou, ou o
 * cadastro do paciente falhou e o modal foi fechado. O front já tenta
 * descartar nesses casos (`POST /patients/photos/discard`), mas é best-effort:
 * aba fechada, rede caída e erro no próprio descarte deixam o objeto lá.
 *
 * "Referenciado" conta também paciente excluído (soft delete) — restaurado,
 * ele não pode voltar sem foto. Mesma regra do `PatientsService.fotoEmUso`.
 */
@Injectable()
export class FotosPacienteOrfasService {
  private readonly logger = new Logger(FotosPacienteOrfasService.name);

  constructor(
    private readonly storageService: StorageService,
    @InjectRepository(Patient)
    private readonly patientRepository: Repository<Patient>,
  ) {}

  async limpar(
    agora: Date = new Date(),
  ): Promise<{ removidas: number; falhas: number }> {
    const limite = agora.getTime() - FOTO_ORFA_JANELA_HORAS * 60 * 60 * 1000;

    const objetos = await this.storageService.listAll(
      STORAGE_FOLDERS.PATIENT_PHOTOS,
    );
    // Sem data não dá para saber se está dentro da janela: fica.
    const antigos = objetos
      .filter((o) => o.lastModified && o.lastModified.getTime() < limite)
      .map((o) => o.key);

    let removidas = 0;
    let falhas = 0;
    for (let i = 0; i < antigos.length; i += LOTE) {
      const lote = antigos.slice(i, i + LOTE);
      const referenciados = await this.referenciados(lote);
      const orfaos = lote.filter((k) => !referenciados.has(k));
      if (!orfaos.length) continue;
      const naoApagados = await this.storageService.deleteMany(orfaos);
      removidas += orfaos.length - naoApagados.length;
      falhas += naoApagados.length;
    }
    return { removidas, falhas };
  }

  /** Caminhos do lote que algum paciente (inclusive excluído) referencia. */
  private async referenciados(caminhos: string[]): Promise<Set<string>> {
    const linhas = (await this.patientRepository.query(
      `SELECT "photo_path" FROM "patients" WHERE "photo_path" = ANY($1)`,
      [caminhos],
    )) as { photo_path: string }[];
    return new Set(linhas.map((l) => l.photo_path));
  }
}
