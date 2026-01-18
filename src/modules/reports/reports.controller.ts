import { Controller, Get, Request } from '@nestjs/common';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  findAll(@Request() req) {
    return this.reportsService.dashboard(req.user.userId);
  }
}
