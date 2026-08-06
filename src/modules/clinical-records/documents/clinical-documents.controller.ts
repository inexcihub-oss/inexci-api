import { FileInterceptor } from '@nestjs/platform-express';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { ClinicalDocumentGenerationService } from './clinical-document-generation.service';
import { CreateClinicalDocumentDto } from './dto/create-clinical-document.dto';
import { DeleteClinicalDocumentDto } from './dto/delete-clinical-document.dto';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { CreateMedicalCertificateDto } from './dto/create-medical-certificate.dto';
import { CreateExamReferralDto } from './dto/create-exam-referral.dto';
import {
  PreviewExamReferralDto,
  PreviewMedicalCertificateDto,
  PreviewPrescriptionDto,
} from './dto/preview-clinical-document.dto';
import {
  AuthenticatedUser,
  CurrentUser,
} from 'src/shared/decorators/current-user.decorator';
import { RequirePermission } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';

@ApiTags('Documentos do Atendimento')
@ApiBearerAuth()
@Controller('clinical-records/documents')
@RequirePermission(Permission.ATENDIMENTO)
export class ClinicalDocumentsController {
  constructor(
    private readonly clinicalDocumentsService: ClinicalDocumentsService,
    private readonly clinicalDocumentGenerationService: ClinicalDocumentGenerationService,
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

  // ── Documentos emitidos a partir da ficha (PDF gerado pelo sistema) ───────
  // Caminhos fixos abaixo de `clinical-records/documents`, para não disputar
  // rota com o `clinical-records/:id` do controller de fichas.

  @Post('prescription')
  @ApiOperation({ summary: 'Emitir receita do atendimento' })
  createPrescription(
    @Body() data: CreatePrescriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clinicalDocumentGenerationService.generatePrescription(
      data.clinicalRecordId,
      data,
      user.userId,
    );
  }

  @Post('medical-certificate')
  @ApiOperation({ summary: 'Emitir atestado médico do atendimento' })
  createMedicalCertificate(
    @Body() data: CreateMedicalCertificateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clinicalDocumentGenerationService.generateMedicalCertificate(
      data.clinicalRecordId,
      data,
      user.userId,
    );
  }

  @Post('exam-referral')
  @ApiOperation({ summary: 'Emitir encaminhamento de exames do atendimento' })
  createExamReferral(
    @Body() data: CreateExamReferralDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clinicalDocumentGenerationService.generateExamReferral(
      data.clinicalRecordId,
      data,
      user.userId,
    );
  }

  // ── Pré-visualização ──────────────────────────────────────────────────────
  // Devolve o HTML do documento (mesmo template da emissão) para o médico
  // conferir na tela. Nada é gravado, e nenhum PDF é gerado: subir o Chromium
  // a cada clique em "Visualizar" custa segundos e o arquivo seria descartado.
  //
  // A ficha é opcional aqui (e só aqui): conferir um documento não pode criar
  // prontuário. Sem `clinicalRecordId`, o HTML é montado a partir do paciente e
  // dos campos que estão na tela — ver `PreviewTargetDto`.

  @Post('prescription/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pré-visualizar receita' })
  async previewPrescription(
    @Body() data: PreviewPrescriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const html =
      await this.clinicalDocumentGenerationService.previewPrescription(
        data,
        user.userId,
      );
    return { html };
  }

  @Post('medical-certificate/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pré-visualizar atestado médico' })
  async previewMedicalCertificate(
    @Body() data: PreviewMedicalCertificateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const html =
      await this.clinicalDocumentGenerationService.previewMedicalCertificate(
        data,
        user.userId,
      );
    return { html };
  }

  @Post('exam-referral/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pré-visualizar encaminhamento de exames' })
  async previewExamReferral(
    @Body() data: PreviewExamReferralDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const html =
      await this.clinicalDocumentGenerationService.previewExamReferral(
        data,
        user.userId,
      );
    return { html };
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
