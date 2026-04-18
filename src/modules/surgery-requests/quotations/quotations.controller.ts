import { Controller, Post, Body, Put } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { QuotationsService } from './quotations.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';

@ApiTags('Cotações OPME')
@ApiBearerAuth()
@Controller('surgery-requests/quotations')
export class QuotationsController {
  constructor(private readonly quotationsService: QuotationsService) {}

  @Post()
  @ApiOperation({ summary: 'Criar cotação' })
  create(
    @Body() data: CreateQuotationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.quotationsService.create(data, user.userId);
  }

  @Put()
  @ApiOperation({ summary: 'Atualizar cotação' })
  update(
    @Body() data: UpdateQuotationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.quotationsService.update(data, user.userId);
  }
}
