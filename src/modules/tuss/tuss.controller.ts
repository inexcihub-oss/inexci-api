import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { TussService } from './tuss.service';

@ApiTags('TUSS')
@ApiBearerAuth()
@Controller('tuss')
export class TussController {
  constructor(private readonly tussService: TussService) {}

  @Get()
  @ApiOperation({ summary: 'Buscar códigos TUSS' })
  @ApiQuery({ name: 'search', required: false, description: 'Termo de busca' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Limite de resultados',
  })
  search(@Query('search') search?: string, @Query('limit') limit?: string) {
    return this.tussService.search(search, limit ? parseInt(limit) : 50);
  }
}
