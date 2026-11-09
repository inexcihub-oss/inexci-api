import { Injectable } from '@nestjs/common';
import { AiTokenUsageLogRepository } from '../../database/repositories/ai-token-usage-log.repository';
import { AiUsageQueryDto, AiUsageReportRowDto } from './dto/ai-usage.dto';

export type AiUsageReportRow = AiUsageReportRowDto;

@Injectable()
export class AiUsageService {
  constructor(private readonly repo: AiTokenUsageLogRepository) {}

  getReport(params: AiUsageQueryDto): Promise<AiUsageReportRowDto[]> {
    return this.repo.report(params);
  }
}
