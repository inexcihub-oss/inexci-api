import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformAdminOnly } from '../auth/platform-admin-only.decorator';
import { AdminSystemService } from './admin-system.service';
import { SystemJobDto } from './dto/system-jobs.dto';

@ApiTags('Admin')
@PlatformAdminOnly()
@Controller('admin/system')
export class AdminSystemController {
  constructor(private readonly service: AdminSystemService) {}

  @Get('jobs')
  @ApiOperation({
    summary: 'Tarefas automáticas e a última execução manual de cada uma',
  })
  @ApiOkResponse({ type: [SystemJobDto] })
  jobs(): Promise<SystemJobDto[]> {
    return this.service.listJobs();
  }
}
