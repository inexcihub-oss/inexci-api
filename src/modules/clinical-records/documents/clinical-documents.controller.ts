import { FileInterceptor } from '@nestjs/platform-express';
import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ClinicalDocumentsService } from './clinical-documents.service';
import { CreateClinicalDocumentDto } from './dto/create-clinical-document.dto';
import { DeleteClinicalDocumentDto } from './dto/delete-clinical-document.dto';
import {
  AuthenticatedUser,
  CurrentUser,
} from 'src/shared/decorators/current-user.decorator';

@ApiTags('Documentos do Atendimento')
@ApiBearerAuth()
@Controller('clinical-records/documents')
export class ClinicalDocumentsController {
  constructor(
    private readonly clinicalDocumentsService: ClinicalDocumentsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Enviar documento/exame do paciente' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('document', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  create(
    @Body() data: CreateClinicalDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.clinicalDocumentsService.create(data, user.userId, file);
  }

  @Get()
  @ApiOperation({ summary: 'Listar documentos do paciente' })
  list(
    @Query('patientId') patientId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clinicalDocumentsService.listByPatient(patientId, user.userId);
  }

  @Delete()
  @ApiOperation({ summary: 'Excluir documento do paciente' })
  delete(
    @Body() data: DeleteClinicalDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clinicalDocumentsService.delete(data, user.userId);
  }
}
