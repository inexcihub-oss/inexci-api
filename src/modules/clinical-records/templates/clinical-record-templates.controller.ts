import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from 'src/shared/decorators/current-user.decorator';
import { ClinicalRecordTemplatesService } from './clinical-record-templates.service';
import { CreateClinicalRecordTemplateDto } from './dto/create-clinical-record-template.dto';
import { UpdateClinicalRecordTemplateDto } from './dto/update-clinical-record-template.dto';

@ApiTags('Modelos de anamnese')
@ApiBearerAuth()
@Controller('clinical-records/templates')
export class ClinicalRecordTemplatesController {
  constructor(
    private readonly templatesService: ClinicalRecordTemplatesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar modelos de anamnese da clínica' })
  find(
    @Query('doctorId') doctorId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.templatesService.findMany(user.userId, doctorId);
  }

  @Post()
  @ApiOperation({ summary: 'Criar modelo de anamnese' })
  create(
    @Body() data: CreateClinicalRecordTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.templatesService.create(data, user.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar modelo de anamnese' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: UpdateClinicalRecordTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.templatesService.update(id, data, user.userId);
  }

  @Post(':id/apply')
  @ApiOperation({ summary: 'Aplicar modelo na ficha (conta o uso)' })
  apply(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.templatesService.apply(id, user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir modelo de anamnese' })
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.templatesService.delete(id, user.userId);
  }
}
