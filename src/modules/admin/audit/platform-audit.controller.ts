import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformAuditService } from './platform-audit.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';
import { PlatformAuditLogListResponseDto } from './dto/platform-audit-log-response.dto';
import { PlatformAdminOnly } from '../auth/platform-admin-only.decorator';

@ApiTags('Admin')
@PlatformAdminOnly()
@Controller('admin/audit-logs')
export class PlatformAuditController {
  constructor(private readonly auditService: PlatformAuditService) {}

  @Get()
  @ApiOperation({ summary: 'Histórico de ações do painel administrativo' })
  @ApiOkResponse({ type: PlatformAuditLogListResponseDto })
  list(
    @Query() query: ListAuditLogsQueryDto,
  ): Promise<PlatformAuditLogListResponseDto> {
    return this.auditService.list({
      targetOwnerId: query.targetOwnerId,
      actorAdminId: query.actorUserId,
      action: query.action,
      from: query.from,
      to: query.to,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    });
  }
}
