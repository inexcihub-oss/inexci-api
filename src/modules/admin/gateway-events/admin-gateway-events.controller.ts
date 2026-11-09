import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { AuthenticatedAdmin } from '../auth/admin-session.guard';
import {
  CurrentAdmin,
  PlatformAdminOnly,
} from '../auth/platform-admin-only.decorator';
import { AdminGatewayEventsService } from './admin-gateway-events.service';
import {
  AdminGatewayEventsQueryDto,
  AdminGatewayEventsResponseDto,
  ReprocessGatewayEventDto,
  ReprocessGatewayEventResultDto,
} from './dto/admin-gateway-events.dto';

@ApiTags('Admin')
@PlatformAdminOnly()
@Controller('admin/stripe-events')
export class AdminGatewayEventsController {
  constructor(private readonly service: AdminGatewayEventsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Eventos recebidos da Stripe, com a conta, a situação e o erro de processamento',
  })
  @ApiOkResponse({ type: AdminGatewayEventsResponseDto })
  list(
    @Query() query: AdminGatewayEventsQueryDto,
  ): Promise<AdminGatewayEventsResponseDto> {
    return this.service.list({
      ownerId: query.ownerId,
      problems: query.problems,
      limit: query.limit ?? 25,
      offset: query.offset ?? 0,
    });
  }

  @Post(':id/reprocess')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Processa de novo um evento da Stripe que falhou ou ficou pendente',
  })
  @ApiOkResponse({ type: ReprocessGatewayEventResultDto })
  @ApiBadRequestResponse({ description: 'Motivo inválido' })
  @ApiNotFoundResponse({ description: 'Evento não encontrado' })
  @ApiConflictResponse({ description: 'O evento já foi processado' })
  @ApiUnprocessableEntityResponse({
    description: 'O processamento falhou de novo',
  })
  reprocess(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() dto: ReprocessGatewayEventDto,
  ): Promise<ReprocessGatewayEventResultDto> {
    return this.service.reprocess(id, dto.reason, admin.adminId);
  }
}
