import { Controller, Post, Body, Request, Delete, Param, Put } from '@nestjs/common';
import { OpmeService } from './opme.service';
import { CreateOpmeDto } from './dto/create-opme.dto';
import { UpdateOpmeDto } from './dto/update-opme.dto';

@Controller('surgery-requests/opme')
export class OpmeController {
  constructor(private readonly opmeService: OpmeService) {}

  @Post()
  create(@Body() data: CreateOpmeDto, @Request() req) {
    return this.opmeService.create(data, req.user.userId);
  }

  @Put()
  update(@Body() data: UpdateOpmeDto, @Request() req) {
    return this.opmeService.update(data, req.user.userId);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Request() req) {
    return this.opmeService.delete(id, req.user.userId);
  }
}
