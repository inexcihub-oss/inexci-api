import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ProceduresService } from './procedures.service';
import { FindManyProcedureDto } from './dto/find-many-procedure.dto';
import { CreateProcedureDto } from './dto/create-procedure.dto';

@Controller('procedures')
export class ProceduresController {
  constructor(private readonly proceduresService: ProceduresService) {}

  @Get()
  findAll(@Query() query: FindManyProcedureDto) {
    return this.proceduresService.findAll(query);
  }

  @Post()
  create(@Body() data: CreateProcedureDto) {
    return this.proceduresService.create(data);
  }
}
