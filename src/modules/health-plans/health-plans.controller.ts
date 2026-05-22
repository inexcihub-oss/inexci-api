import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Roles } from 'src/shared/decorators/roles.decorator';
import { UserRole } from 'src/database/entities/user.entity';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';
import { HealthPlansService } from './health-plans.service';
import { FindManyHealthPlanDto } from './dto/find-many-health-plan.dto';
import { CreateHealthPlanDto } from './dto/create-health-plan.dto';
import { UpdateHealthPlanDto } from './dto/update-health-plan.dto';
import { BulkDeleteHealthPlansDto } from './dto/bulk-delete-health-plans.dto';

@ApiTags('Planos de Saúde')
@ApiBearerAuth()
@Controller('health_plans')
export class HealthPlansController {
  constructor(private readonly healthPlansService: HealthPlansService) {}

  @Get()
  @ApiOperation({ summary: 'Listar planos de saúde' })
  findAll(
    @Query() query: FindManyHealthPlanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.healthPlansService.findAll(query, user.userId);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Criar plano de saúde' })
  @ApiResponse({ status: 201, description: 'Plano criado' })
  create(
    @Body() data: CreateHealthPlanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.healthPlansService.create(data, user.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar plano de saúde' })
  update(
    @Param('id') id: string,
    @Body() data: UpdateHealthPlanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.healthPlansService.update(id, data, user.userId);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Excluir plano de saúde (soft delete)' })
  delete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.healthPlansService.delete(id, user.userId);
  }

  @Post('bulk-delete')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Excluir planos de saúde em lote (soft delete)' })
  bulkDelete(
    @Body() data: BulkDeleteHealthPlansDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.healthPlansService.bulkDelete(data.ids, user.userId);
  }
}
