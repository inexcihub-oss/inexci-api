import { Controller, Post, Body, Request } from '@nestjs/common';
import { OpmeService } from './opme.service';
import { CreateOpmeDto } from './dto/create-opme.dto';

@Controller('surgery-requests/opme')
export class OpmeController {
  constructor(private readonly opmeService: OpmeService) {}

  @Post()
  create(@Body() data: CreateOpmeDto, @Request() req) {
    return this.opmeService.create(data, req.user.userId);
  }
}
