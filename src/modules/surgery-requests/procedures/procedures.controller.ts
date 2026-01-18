import { Controller, Post, Body } from '@nestjs/common';
import { ProceduresService } from './procedures.service';
import { CreateSurgeryRequestProcedureDto } from './dto/create-surgery-request-procedure.dto';
import { AuthorizeProceduresDto } from './dto/authorize-procedures.dto';

@Controller('surgery-requests/procedures')
export class ProceduresController {
  constructor(private readonly proceduresService: ProceduresService) {}

  @Post()
  create(@Body() data: CreateSurgeryRequestProcedureDto) {
    return this.proceduresService.create(data);
  }

  @Post('authorize')
  authorize(@Body() data: AuthorizeProceduresDto) {
    return this.proceduresService.authorize(data);
  }
}
