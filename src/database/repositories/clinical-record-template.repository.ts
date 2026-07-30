import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ClinicalRecordTemplate } from '../entities/clinical-record-template.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class ClinicalRecordTemplateRepository extends BaseRepository<ClinicalRecordTemplate> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(ClinicalRecordTemplate));
  }

  /**
   * Modelos da clínica, opcionalmente só os de um médico. Os mais usados
   * primeiro — é o que o médico procura no meio do atendimento.
   */
  findByOwner(
    ownerId: string,
    doctorId?: string,
  ): Promise<ClinicalRecordTemplate[]> {
    return this.repository.find({
      where: doctorId ? { ownerId, doctorId } : { ownerId },
      order: { usageCount: 'DESC', name: 'ASC' },
    });
  }

  /** Conta mais um uso sem reler o registro. */
  async incrementUsage(id: string): Promise<void> {
    await this.repository.increment({ id }, 'usageCount', 1);
  }
}
