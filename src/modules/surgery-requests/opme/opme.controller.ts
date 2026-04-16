import { Controller, Post, Body, Delete, Param, Put } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OpmeService } from './opme.service';
import { CreateOpmeDto } from './dto/create-opme.dto';
import { UpdateOpmeDto } from './dto/update-opme.dto';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';

@ApiTags('OPME')
@ApiBearerAuth()
@Controller('surgery-requests/opme')
export class OpmeController {
  constructor(private readonly opmeService: OpmeService) {}

  @Post()
  @ApiOperation({ summary: 'Criar item OPME' })
  create(@Body() data: CreateOpmeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.opmeService.create(data, user.userId);
  }

  @Put()
  @ApiOperation({ summary: 'Atualizar item OPME' })
  update(@Body() data: UpdateOpmeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.opmeService.update(data, user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir item OPME' })
  delete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.opmeService.delete(id, user.userId);
  }
}
