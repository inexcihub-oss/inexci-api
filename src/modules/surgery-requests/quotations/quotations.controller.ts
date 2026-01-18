import { Controller, Post, Body, Request, Put } from '@nestjs/common';
import { QuotationsService } from './quotations.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';

@Controller('surgery-requests/quotations')
export class QuotationsController {
  constructor(private readonly quotationsService: QuotationsService) {}

  @Post()
  create(@Body() data: CreateQuotationDto, @Request() req) {
    return this.quotationsService.create(data, req.user.userId);
  }

  @Put()
  update(@Body() data: UpdateQuotationDto, @Request() req) {
    return this.quotationsService.update(data, req.user.userId);
  }
}
