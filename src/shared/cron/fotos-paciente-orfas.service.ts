import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Patient } from 'src/database/entities/patient.entity';
import { StorageService } from 'src/shared/storage/storage.service';
import { STORAGE_FOLDERS } from 'src/config/storage.config';

export const FOTO_ORFA_JANELA_HORAS = 24;

const LOTE = 1000;

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

  private async referenciados(caminhos: string[]): Promise<Set<string>> {
    const linhas = await this.patientRepository.query<{ photo_path: string }[]>(
      `SELECT "photo_path" FROM "patients" WHERE "photo_path" = ANY($1)`,
      [caminhos],
    );
    return new Set(linhas.map((l) => l.photo_path));
  }
}
