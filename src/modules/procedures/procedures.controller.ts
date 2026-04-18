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

@ApiTags('Procedimentos (catálogo)')
@ApiBearerAuth()
@Controller('procedures')
export class ProceduresController {
  constructor(private readonly proceduresService: ProceduresService) {}

  @Get()
  @ApiOperation({ summary: 'Listar procedimentos' })
  findAll(@Query() query: FindManyProcedureDto) {
    return this.proceduresService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar procedimento por ID' })
  findOne(@Param('id') id: string) {
    return this.proceduresService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Criar procedimento' })
  create(@Body() data: CreateProcedureDto) {
    return this.proceduresService.create(data);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Atualizar procedimento' })
  update(@Param('id') id: string, @Body() data: UpdateProcedureDto) {
    return this.proceduresService.update(id, data);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Excluir procedimento (soft delete)' })
  delete(@Param('id') id: string) {
    return this.proceduresService.delete(id);
  }
}
