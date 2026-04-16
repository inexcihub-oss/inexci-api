import { Controller, Post, Body, Delete, Param, Put } from '@nestjs/common';
import { OpmeService } from './opme.service';
import { CreateOpmeDto } from './dto/create-opme.dto';
import { UpdateOpmeDto } from './dto/update-opme.dto';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';

@Controller('surgery-requests/opme')
export class OpmeController {
  constructor(private readonly opmeService: OpmeService) {}

  @Post()
  create(
    @Body() data: CreateOpmeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.opmeService.create(data, user.userId);
  }

  @Put()
  update(
    @Body() data: UpdateOpmeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.opmeService.update(data, user.userId);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.opmeService.delete(id, user.userId);
  }
}
