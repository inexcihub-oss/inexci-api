import { Controller, Get, Query } from '@nestjs/common';
import { TussService } from './tuss.service';

@Controller('tuss')
export class TussController {
  constructor(private readonly tussService: TussService) {}

  @Get()
  search(@Query('search') search?: string, @Query('limit') limit?: string) {
    return this.tussService.search(search, limit ? parseInt(limit) : 50);
  }
}
