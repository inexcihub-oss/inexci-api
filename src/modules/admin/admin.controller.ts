import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../../shared/decorators/roles.decorator';
import { UserRole } from '../../database/entities/user.entity';
import { AiUsageService, AiUsageReportRow } from './ai-usage.service';

class AiUsageQueryDto {
  from?: string;
  to?: string;
  groupBy?: 'user' | 'model' | 'day';
}

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminController {
  constructor(private readonly aiUsageService: AiUsageService) {}

  @Get('ai-usage/report')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Relatório de uso de IA (custo por usuário/mês/modelo)',
  })
  async getAiUsageReport(
    @Query() query: AiUsageQueryDto,
  ): Promise<AiUsageReportRow[]> {
    return this.aiUsageService.getReport({
      from: query.from,
      to: query.to,
      groupBy: query.groupBy,
    });
  }
}
