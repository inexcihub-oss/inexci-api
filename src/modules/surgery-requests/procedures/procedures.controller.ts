import { Controller, Post, Patch, Body, Delete, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ProceduresService } from './procedures.service';
import { CreateSurgeryRequestProcedureDto } from './dto/create-surgery-request-procedure.dto';
import { UpdateSurgeryRequestProcedureDto } from './dto/update-surgery-request-procedure.dto';
import { AuthorizeProceduresDto } from './dto/authorize-procedures.dto';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';
import { RequirePermission } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';

@ApiTags('Procedimentos da Solicitação')
@ApiBearerAuth()
@Controller('surgery-requests/procedures')
@RequirePermission(Permission.SOLICITACOES)
export class ProceduresController {
  constructor(private readonly proceduresService: ProceduresService) {}

  @Post()
  @ApiOperation({ summary: 'Adicionar procedimentos à solicitação' })
  create(
    @Body() data: CreateSurgeryRequestProcedureDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.proceduresService.create(data, user.userId);
  }

  @Post('authorize')
  @ApiOperation({ summary: 'Autorizar procedimentos' })
  authorize(
    @Body() data: AuthorizeProceduresDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.proceduresService.authorize(data, user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remover procedimento da solicitação' })
  delete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.proceduresService.delete(id, user.userId);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Atualizar quantidade de procedimento da solicitação',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSurgeryRequestProcedureDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.proceduresService.update(id, dto, user.userId);
  }
}
