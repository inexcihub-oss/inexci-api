import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ActivitiesService } from './activities.service';
import { CreateActivityDto } from './dto/create-activity.dto';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';
import { SurgeryRequestOwnerGuard } from 'src/shared/guards/surgery-request-owner.guard';

@ApiTags('Atividades da Solicitação')
@ApiBearerAuth()
@UseGuards(SurgeryRequestOwnerGuard)
@Controller('surgery-requests/:id/activities')
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar atividades' })
  findAll(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.activitiesService.findAll(id, user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Criar atividade' })
  create(
    @Param('id') id: string,
    @Body() dto: CreateActivityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.activitiesService.create(id, dto, user.userId);
  }
}
