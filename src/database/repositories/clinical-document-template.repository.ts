import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere } from 'typeorm';
import {
  ClinicalDocumentTemplate,
  ClinicalDocumentTemplateKind,
} from '../entities/clinical-document-template.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class ClinicalDocumentTemplateRepository extends BaseRepository<ClinicalDocumentTemplate> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(ClinicalDocumentTemplate));
  }

  findByOwner(
    ownerId: string,
    filtro: { kind?: ClinicalDocumentTemplateKind; doctorId?: string } = {},
  ): Promise<ClinicalDocumentTemplate[]> {
    const where: FindOptionsWhere<ClinicalDocumentTemplate> = { ownerId };
    if (filtro.kind) where.kind = filtro.kind;
    if (filtro.doctorId) where.doctorId = filtro.doctorId;
    return this.repository.find({
      where,
      order: { usageCount: 'DESC', name: 'ASC' },
    });
  }

  async incrementUsage(id: string): Promise<void> {
    await this.repository.increment({ id }, 'usageCount', 1);
  }
}
