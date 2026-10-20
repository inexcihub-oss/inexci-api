import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ClinicalAccessAuditEntry,
  ClinicalAccessAuditRepository,
} from 'src/database/repositories/clinical-access-audit.repository';
import { registerProntuarioAuditSink } from './audit';

@Injectable()
export class ClinicalAccessAuditService
  implements OnModuleInit, OnModuleDestroy
{
  constructor(private readonly repository: ClinicalAccessAuditRepository) {}

  onModuleInit(): void {
    registerProntuarioAuditSink((entry) => this.record(entry));
  }

  onModuleDestroy(): void {
    registerProntuarioAuditSink(null);
  }

  record(entry: ClinicalAccessAuditEntry): Promise<void> {
    return this.repository.record(entry);
  }
}
