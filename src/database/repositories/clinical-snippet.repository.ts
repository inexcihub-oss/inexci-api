import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, Not } from 'typeorm';
import { ClinicalSnippet } from '../entities/clinical-snippet.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class ClinicalSnippetRepository extends BaseRepository<ClinicalSnippet> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(ClinicalSnippet));
  }

  findByDoctor(ownerId: string, doctorId: string): Promise<ClinicalSnippet[]> {
    return this.repository.find({
      where: { ownerId, doctorId },
      order: { usageCount: 'DESC', shortcut: 'ASC' },
    });
  }

  async shortcutInUse(
    doctorId: string,
    shortcut: string,
    exceptId?: string,
  ): Promise<boolean> {
    const where: FindOptionsWhere<ClinicalSnippet> = { doctorId, shortcut };
    if (exceptId) where.id = Not(exceptId);
    return (await this.repository.count({ where })) > 0;
  }

  async incrementUsage(id: string): Promise<void> {
    await this.repository.increment({ id }, 'usageCount', 1);
  }
}
