import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedAdmin } from '../auth/admin-session.guard';
import {
  CurrentAdmin,
  PlatformAdminOnly,
} from '../auth/platform-admin-only.decorator';
import { AdminQueuesService } from './admin-queues.service';
import {
  AdminFailedJobsQueryDto,
  AdminFailedJobsResponseDto,
  AdminQueueJobActionDto,
  AdminQueueJobActionResultDto,
  AdminQueuesOverviewDto,
} from './dto/admin-queues.dto';
import { JobIdPipe } from './job-id.pipe';

@ApiTags('Admin')
@PlatformAdminOnly()
@Controller('admin/system/queues')
export class AdminQueuesController {
  constructor(private readonly service: AdminQueuesService) {}

  @Get()
  @ApiOperation({
    summary: 'Situação de cada fila de tarefas em segundo plano',
  })
  @ApiOkResponse({ type: AdminQueuesOverviewDto })
  @ApiServiceUnavailableResponse({ description: 'Redis indisponível' })
  overview(): Promise<AdminQueuesOverviewDto> {
    return this.service.overview();
  }

  @Get('failed')
  @ApiOperation({
    summary: 'Tarefas com falha, sem o conteúdo do job (só fila, conta e erro)',
  })
  @ApiOkResponse({ type: AdminFailedJobsResponseDto })
  @ApiServiceUnavailableResponse({ description: 'Redis indisponível' })
  failed(
    @Query() query: AdminFailedJobsQueryDto,
  ): Promise<AdminFailedJobsResponseDto> {
    return this.service.listFailed({
      queue: query.queue,
      limit: query.limit ?? 25,
      offset: query.offset ?? 0,
    });
  }

  @Post(':queue/jobs/:jobId/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Coloca uma tarefa com falha para rodar de novo' })
  @ApiOkResponse({ type: AdminQueueJobActionResultDto })
  @ApiBadRequestResponse({ description: 'Motivo ou identificador inválido' })
  @ApiNotFoundResponse({ description: 'Fila ou tarefa não encontrada' })
  @ApiConflictResponse({ description: 'A tarefa não está com falha' })
  @ApiServiceUnavailableResponse({ description: 'Redis indisponível' })
  retry(
    @Param('queue') queue: string,
    @Param('jobId', JobIdPipe) jobId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() dto: AdminQueueJobActionDto,
  ): Promise<AdminQueueJobActionResultDto> {
    return this.service.retry(queue, jobId, dto.reason, admin.adminId);
  }

  @Post(':queue/jobs/:jobId/discard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove uma tarefa com falha da fila' })
  @ApiOkResponse({ type: AdminQueueJobActionResultDto })
  @ApiBadRequestResponse({ description: 'Motivo ou identificador inválido' })
  @ApiNotFoundResponse({ description: 'Fila ou tarefa não encontrada' })
  @ApiConflictResponse({ description: 'A tarefa não está com falha' })
  @ApiServiceUnavailableResponse({ description: 'Redis indisponível' })
  discard(
    @Param('queue') queue: string,
    @Param('jobId', JobIdPipe) jobId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() dto: AdminQueueJobActionDto,
  ): Promise<AdminQueueJobActionResultDto> {
    return this.service.discard(queue, jobId, dto.reason, admin.adminId);
  }
}
