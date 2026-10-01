import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClinicalDocumentTemplateKind } from 'src/database/entities/clinical-document-template.entity';
import {
  AuthenticatedUser,
  CurrentUser,
} from 'src/shared/decorators/current-user.decorator';
import { RequirePermission } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import { DOCUMENT_PLACEHOLDERS } from 'src/shared/pdf/placeholders.util';
import { ClinicalDocumentGenerationService } from '../documents/clinical-document-generation.service';
import { ClinicalDocumentTemplatesService } from './clinical-document-templates.service';
import { ApplyClinicalDocumentTemplateDto } from './dto/apply-clinical-document-template.dto';
import { CreateClinicalDocumentTemplateDto } from './dto/create-clinical-document-template.dto';
import { UpdateClinicalDocumentTemplateDto } from './dto/update-clinical-document-template.dto';

@ApiTags('Modelos de documentos clínicos')
@ApiBearerAuth()
@Controller('clinical-records/document-templates')
@RequirePermission(Permission.ATENDIMENTO)
export class ClinicalDocumentTemplatesController {
  constructor(
    private readonly templatesService: ClinicalDocumentTemplatesService,
    private readonly generationService: ClinicalDocumentGenerationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar modelos de atestado/pedido de exame' })
  find(
    @Query(
      'kind',
      new ParseEnumPipe(ClinicalDocumentTemplateKind, { optional: true }),
    )
    kind: ClinicalDocumentTemplateKind | undefined,
    @Query('doctorId', new ParseUUIDPipe({ optional: true }))
    doctorId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.templatesService.findMany(user.userId, { kind, doctorId });
  }

  @Get('placeholders')
  @ApiOperation({ summary: 'Placeholders aceitos nos modelos' })
  placeholders() {
    return Object.entries(DOCUMENT_PLACEHOLDERS).map(([key, label]) => ({
      key,
      label,
    }));
  }

  @Post()
  @ApiOperation({ summary: 'Criar modelo de documento' })
  create(
    @Body() data: CreateClinicalDocumentTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.templatesService.create(data, user.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar modelo de documento' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: UpdateClinicalDocumentTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.templatesService.update(id, data, user.userId);
  }

  @Post(':id/apply')
  @ApiOperation({
    summary: 'Texto do modelo com os placeholders preenchidos (conta o uso)',
  })
  apply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: ApplyClinicalDocumentTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.generationService.applyTemplate(id, data, user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir modelo de documento' })
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.templatesService.delete(id, user.userId);
  }
}
