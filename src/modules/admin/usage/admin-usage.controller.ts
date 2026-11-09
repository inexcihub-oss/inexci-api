import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminUsageService } from './admin-usage.service';
import {
  AdminUsageInactiveQueryDto,
  AdminUsageQueryDto,
} from './dto/admin-usage-query.dto';
import {
  AdminInactiveAccountsResponseDto,
  AdminUsageResponseDto,
} from './dto/admin-usage-response.dto';
import { PlatformAdminOnly } from '../auth/platform-admin-only.decorator';

@ApiTags('Admin')
@PlatformAdminOnly()
@Controller('admin/usage')
export class AdminUsageController {
  constructor(private readonly service: AdminUsageService) {}

  @Get()
  @ApiOperation({
    summary:
      'Uso da plataforma: totais, série semanal, contas ativas e rankings (só contagens)',
  })
  @ApiOkResponse({ type: AdminUsageResponseDto })
  usage(@Query() query: AdminUsageQueryDto): Promise<AdminUsageResponseDto> {
    if (query.from && query.to && query.to <= query.from) {
      throw new BadRequestException('"to" deve ser posterior a "from"');
    }
    return this.service.getUsage(query);
  }

  @Get('inactive')
  @ApiOperation({
    summary: 'Contas cliente sem acesso há N dias (7, 15 ou 30)',
  })
  @ApiOkResponse({ type: AdminInactiveAccountsResponseDto })
  inactive(
    @Query() query: AdminUsageInactiveQueryDto,
  ): Promise<AdminInactiveAccountsResponseDto> {
    return this.service.getInactive(query.days ?? 7);
  }
}
