import { Controller, Get, Query, Request } from '@nestjs/common';
import { PendenciesService } from './pendencies.service';
import { FindManyPendenciesDto } from './dto/find-many-pendencies.dto';

@Controller('surgery-requests/pendencies')
export class PendenciesController {
  constructor(private readonly pendenciesService: PendenciesService) {}

  @Get()
  findAll(@Query() query: FindManyPendenciesDto, @Request() req) {
    return this.pendenciesService.findAll(query, req.user.userId);
  }
}
