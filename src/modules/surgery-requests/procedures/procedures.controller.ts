import { Controller, Post, Body, Delete, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ProceduresService } from './procedures.service';
import { CreateSurgeryRequestProcedureDto } from './dto/create-surgery-request-procedure.dto';
import { AuthorizeProceduresDto } from './dto/authorize-procedures.dto';

@ApiTags('Procedimentos da Solicitação')
@ApiBearerAuth()
@Controller('surgery-requests/procedures')
export class ProceduresController {
  constructor(private readonly proceduresService: ProceduresService) {}

  @Post()
  @ApiOperation({ summary: 'Adicionar procedimentos à solicitação' })
  create(@Body() data: CreateSurgeryRequestProcedureDto) {
    return this.proceduresService.create(data);
  }

  @Post('authorize')
  @ApiOperation({ summary: 'Autorizar procedimentos' })
  authorize(@Body() data: AuthorizeProceduresDto) {
    return this.proceduresService.authorize(data);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remover procedimento da solicitação' })
  delete(@Param('id') id: string) {
    return this.proceduresService.delete(id);
  }
}
