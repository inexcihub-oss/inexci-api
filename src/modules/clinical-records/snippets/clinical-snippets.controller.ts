import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from 'src/shared/decorators/current-user.decorator';
import { RequirePermission } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import { ClinicalSnippetsService } from './clinical-snippets.service';
import { CreateClinicalSnippetDto } from './dto/create-clinical-snippet.dto';
import { UpdateClinicalSnippetDto } from './dto/update-clinical-snippet.dto';

@ApiTags('Textos rápidos do prontuário')
@ApiBearerAuth()
@Controller('clinical-records/snippets')
@RequirePermission(Permission.ATENDIMENTO)
export class ClinicalSnippetsController {
  constructor(private readonly snippetsService: ClinicalSnippetsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar os textos rápidos do próprio médico' })
  find(@CurrentUser() user: AuthenticatedUser) {
    return this.snippetsService.findMany(user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Criar texto rápido' })
  create(
    @Body() data: CreateClinicalSnippetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.snippetsService.create(data, user.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar texto rápido' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: UpdateClinicalSnippetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.snippetsService.update(id, data, user.userId);
  }

  @Post(':id/use')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Registrar uso do texto rápido' })
  use(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.snippetsService.registerUse(id, user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir texto rápido' })
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.snippetsService.delete(id, user.userId);
  }
}
