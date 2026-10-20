import { Injectable } from '@nestjs/common';
import { DataSource, LessThan } from 'typeorm';
import {
  ClinicalAccessAudit,
  ClinicalAccessOrigin,
} from '../entities/clinical-access-audit.entity';
import { BaseRepository } from './base.repository';

export interface ClinicalAccessAuditEntry {
  actorUserId: string | null;
  ownerId: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  patientId: string | null;
  origin: ClinicalAccessOrigin;
  ip: string | null;
  requestId: string | null;
}

@Injectable()
export class ClinicalAccessAuditRepository extends BaseRepository<ClinicalAccessAudit> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(ClinicalAccessAudit));
  }

  async record(entry: ClinicalAccessAuditEntry): Promise<void> {
    await this.repository.insert(entry);
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await this.repository.delete({
      createdAt: LessThan(cutoff),
    });
    return result.affected ?? 0;
  }
}
