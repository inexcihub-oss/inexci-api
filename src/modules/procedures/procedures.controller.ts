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
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from 'src/shared/decorators/roles.decorator';
import { UserRole } from 'src/database/entities/user.entity';
import { ProceduresService } from './procedures.service';
import { FindManyProcedureDto } from './dto/find-many-procedure.dto';
import { CreateProcedureDto } from './dto/create-procedure.dto';
import { UpdateProcedureDto } from './dto/update-procedure.dto';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';

@ApiTags('Procedimentos (catálogo)')
@ApiBearerAuth()
@Controller('procedures')
export class ProceduresController {
  constructor(private readonly proceduresService: ProceduresService) {}

  @Get()
  @ApiOperation({ summary: 'Listar procedimentos' })
  findAll(
    @Query() query: FindManyProcedureDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.proceduresService.findAll(query, user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar procedimento por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.proceduresService.findOne(id, user.userId);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Criar procedimento' })
  create(
    @Body() data: CreateProcedureDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.proceduresService.create(data, user.userId);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Atualizar procedimento' })
  update(
    @Param('id') id: string,
    @Body() data: UpdateProcedureDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.proceduresService.update(id, data, user.userId);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Excluir procedimento (soft delete)' })
  delete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.proceduresService.delete(id, user.userId);
  }
}
