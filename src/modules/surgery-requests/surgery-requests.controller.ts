import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Put,
  Patch,
  Delete,
  Param,
  Res,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import {
  SurgeryRequestOwnerGuard,
  SkipSurgeryOwner,
} from 'src/shared/guards/surgery-request-owner.guard';
import { RequirePermission } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { SurgeryRequestsService } from './surgery-requests.service';
import { SurgeryRequestWorkflowService } from './services/surgery-request-workflow.service';
import { SurgeryRequestFromDocumentService } from './services/surgery-request-from-document.service';
import { CreateFromDocumentDto } from './dto/create-from-document.dto';
import { ApplyDocumentExtractionDto } from './dto/apply-document-extraction.dto';
import {
  ExtractFromDocumentJobStatusResponseDto,
  ExtractFromDocumentQueuedResponseDto,
} from './dto/extract-from-document-job.dto';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';
import { SurgeryRequestDocumentExtractionJobsService } from './services/surgery-request-document-extraction-jobs.service';

import { CreateSurgeryRequestSimpleDto } from './dto/create-surgery-request-simple.dto';
import { FindManySurgeryRequestDto } from './dto/find-many.dto';
import { FindManyKanbanDto } from './dto/find-many-kanban.dto';
import { FindAgendaDto } from './dto/find-agenda.dto';
import { FindOneSurgeryRequestDto } from './dto/find-one.dto';
import { UpdateSurgeryRequestDto } from './dto/update-surgery-request.dto';
import { UpdateSurgeryRequestBasicDto } from './dto/update-surgery-request-basic.dto';

import { SendRequestDto } from './dto/send-request.dto';
import { StartAnalysisDto } from './dto/start-analysis.dto';
import { AcceptAuthorizationDto } from './dto/accept-authorization.dto';
import { ContestAuthorizationDto } from './dto/contest-authorization.dto';
import { ConfirmDateDto } from './dto/confirm-date.dto';
import { UpdateDateOptionsDto } from './dto/update-date-options.dto';
import { RescheduleDto } from './dto/reschedule.dto';
import { MarkPerformedDto } from './dto/mark-performed.dto';
import { InvoiceRequestDto } from './dto/invoice-request.dto';
import { ConfirmReceiptDto } from './dto/confirm-receipt.dto';
import { ContestPaymentDto } from './dto/contest-payment.dto';
import { UpdateReceiptDto } from './dto/update-receipt.dto';
import { CloseSurgeryRequestDto } from './dto/close-surgery-request.dto';
import { NotifySurgeryRequestDto } from './dto/notify-surgery-request.dto';
import { CreateReportSectionDto } from './dto/create-report-section.dto';
import { UpdateReportSectionDto } from './dto/update-report-section.dto';
import { ReorderReportSectionsDto } from './dto/reorder-report-sections.dto';
import { BulkDeleteTemplatesDto } from './dto/bulk-delete-templates.dto';
import { SetHasOpmeDto } from './dto/set-has-opme.dto';
import {
  CreateSurgeryRequestTemplateDto,
  UpdateSurgeryRequestTemplateDto,
} from './dto/surgery-request-template.dto';

@ApiTags('Solicitações Cirúrgicas')
@ApiBearerAuth()
@UseGuards(SurgeryRequestOwnerGuard)
@Controller('surgery-requests')
@RequirePermission(Permission.SOLICITACOES)
export class SurgeryRequestsController {
  constructor(
    private readonly surgeryRequestsService: SurgeryRequestsService,
    private readonly workflowService: SurgeryRequestWorkflowService,
    private readonly fromDocumentService: SurgeryRequestFromDocumentService,
    private readonly documentExtractionJobsService: SurgeryRequestDocumentExtractionJobsService,
  ) {}

  @Post()
  @Throttle({ short: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Criar solicitação cirúrgica' })
  createSurgeryRequest(
    @Body() data: CreateSurgeryRequestSimpleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.createSurgeryRequest(data, user.userId);
  }

  @Post('extract-from-document')
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @ApiOperation({
    summary:
      'Extrai dados de um documento (imagem ou PDF) para pré-preencher uma SC — não persiste.',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('document', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  @HttpCode(HttpStatus.ACCEPTED)
  extractFromDocument(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
    @Body('notifyOnCompletion') notifyOnCompletion?: string,
    @Body('surgeryRequestId') surgeryRequestId?: string,
  ): Promise<ExtractFromDocumentQueuedResponseDto> {
    const options: { notifyOnCompletion?: boolean; surgeryRequestId?: string } =
      {};
    if (notifyOnCompletion === 'false') options.notifyOnCompletion = false;
    if (surgeryRequestId) options.surgeryRequestId = surgeryRequestId;

    if (Object.keys(options).length === 0) {
      return this.documentExtractionJobsService.enqueue(file, user.userId);
    }
    return this.documentExtractionJobsService.enqueue(
      file,
      user.userId,
      options,
    );
  }

  @Get('extract-from-document/:jobId')
  @Throttle({ short: { ttl: 60000, limit: 120 } })
  @ApiOperation({
    summary: 'Consultar status da extração assíncrona de documento.',
  })
  getExtractFromDocumentStatus(
    @Param('jobId') jobId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ExtractFromDocumentJobStatusResponseDto> {
    return this.documentExtractionJobsService.getStatus(jobId, user.userId);
  }

  @Post('from-document')
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @ApiOperation({
    summary: 'Cria uma SC PENDENTE a partir dos dados revisados do documento.',
  })
  createFromDocument(
    @Body() data: CreateFromDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fromDocumentService.createFromDocument(data, user.userId);
  }

  @Post(':id/apply-document-extraction')
  @ApiOperation({
    summary: 'Complementa uma SC pendente com dados extraídos de documento',
  })
  applyDocumentExtraction(
    @Param('id') id: string,
    @Body() data: ApplyDocumentExtractionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fromDocumentService.applyDocumentExtraction(
      id,
      data,
      user.userId,
    );
  }

  @Get()
  @RequirePermission(Permission.SOLICITACOES, Permission.ATENDIMENTO)
  @ApiOperation({ summary: 'Listar solicitações cirúrgicas' })
  findAll(
    @Query() query: FindManySurgeryRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.findAll(
      query,
      user.userId,
      user.permissions,
    );
  }

  @Get('kanban')
  @ApiOperation({
    summary:
      'Listar cards do kanban (payload enxuto + contadores de pendência já embutidos)',
  })
  findAllForKanban(
    @Query() query: FindManyKanbanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.findAllForKanban(query, user.userId);
  }

  @Get('agenda')
  @ApiOperation({
    summary: 'Listar cirurgias da agenda por intervalo de data (surgeryDate)',
  })
  findAgenda(
    @Query() query: FindAgendaDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.findAgenda(query, user.userId);
  }

  @Get('one')
  @ApiOperation({ summary: 'Buscar solicitação por ID' })
  findOne(
    @Query() query: FindOneSurgeryRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.findOne(query.id, user.userId);
  }

  @Put()
  @ApiOperation({ summary: 'Atualizar solicitação cirúrgica' })
  update(
    @Body() data: UpdateSurgeryRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.update(data, user.userId);
  }

  @Get(':id/cc-recipients')
  @ApiOperation({ summary: 'Listar usuários para campo CC do e-mail da SC' })
  getCcRecipients(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.getCcRecipients(id, user.userId);
  }

  @Patch(':id/has-opme')
  @ApiOperation({ summary: 'Definir se possui OPME' })
  setHasOpme(
    @Param('id') id: string,
    @Body() body: SetHasOpmeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.setHasOpme(
      id,
      body.hasOpme,
      user.userId,
    );
  }

  @Patch(':id/basic')
  @ApiOperation({ summary: 'Atualizar dados básicos' })
  updateBasic(
    @Param('id') id: string,
    @Body() data: UpdateSurgeryRequestBasicDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.updateBasic(
      { ...data, id },
      user.userId,
    );
  }

  @Post(':id/send')
  @ApiOperation({ summary: 'Enviar solicitação ao convênio' })
  sendRequest(
    @Param('id') id: string,
    @Body() dto: SendRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflowService.sendRequest(id, dto, user.userId);
  }

  @Post(':id/start-analysis')
  @ApiOperation({ summary: 'Iniciar análise' })
  startAnalysis(
    @Param('id') id: string,
    @Body() dto: StartAnalysisDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflowService.startAnalysis(id, dto, user.userId);
  }

  @Post(':id/accept-authorization')
  @ApiOperation({ summary: 'Aceitar autorização' })
  acceptAuthorization(
    @Param('id') id: string,
    @Body() dto: AcceptAuthorizationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflowService.acceptAuthorization(id, dto, user.userId);
  }

  @Post(':id/contest-authorization')
  @ApiOperation({ summary: 'Contestar autorização' })
  contestAuthorization(
    @Param('id') id: string,
    @Body() dto: ContestAuthorizationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflowService.contestAuthorization(id, dto, user.userId);
  }

  @Get(':id/contest-authorization-pdf')
  @ApiOperation({ summary: 'Gerar PDF de contestação' })
  async getContestAuthorizationPdf(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const buffer = await this.workflowService.generateContestAuthorizationPdf(
      id,
      user.userId,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="contestacao-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.status(HttpStatus.OK).end(buffer);
  }

  @Post(':id/confirm-date')
  @ApiOperation({ summary: 'Confirmar data da cirurgia' })
  confirmDate(
    @Param('id') id: string,
    @Body() dto: ConfirmDateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflowService.confirmDate(id, dto, user.userId);
  }

  @Patch(':id/date-options')
  @ApiOperation({ summary: 'Atualizar opções de data' })
  updateDateOptions(
    @Param('id') id: string,
    @Body() dto: UpdateDateOptionsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflowService.updateDateOptions(id, dto, user.userId);
  }

  @Patch(':id/reschedule')
  @ApiOperation({ summary: 'Reagendar cirurgia' })
  reschedule(
    @Param('id') id: string,
    @Body() dto: RescheduleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflowService.reschedule(id, dto, user.userId);
  }

  @Post(':id/mark-performed')
  @ApiOperation({ summary: 'Marcar como realizada' })
  markPerformed(
    @Param('id') id: string,
    @Body() dto: MarkPerformedDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflowService.markPerformed(id, dto, user.userId);
  }

  @Post(':id/invoice')
  @ApiOperation({ summary: 'Faturar solicitação' })
  invoiceRequest(
    @Param('id') id: string,
    @Body() dto: InvoiceRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflowService.invoiceRequest(id, dto, user.userId);
  }

  @Post(':id/confirm-receipt')
  @ApiOperation({ summary: 'Confirmar recebimento' })
  confirmReceipt(
    @Param('id') id: string,
    @Body() dto: ConfirmReceiptDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflowService.confirmReceipt(id, dto, user.userId);
  }

  @Post(':id/contest-payment')
  @ApiOperation({ summary: 'Contestar pagamento' })
  contestPayment(
    @Param('id') id: string,
    @Body() dto: ContestPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflowService.contestPayment(id, dto, user.userId);
  }

  @Patch(':id/billing/receipt')
  @ApiOperation({ summary: 'Atualizar recebimento' })
  updateReceipt(
    @Param('id') id: string,
    @Body() dto: UpdateReceiptDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflowService.updateReceipt(id, dto, user.userId);
  }

  @Post(':id/close')
  @ApiOperation({ summary: 'Encerrar solicitação' })
  closeSurgeryRequest(
    @Param('id') id: string,
    @Body() dto: CloseSurgeryRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflowService.closeSurgeryRequest(id, dto, user.userId);
  }

  @Post(':id/notify')
  @ApiOperation({ summary: 'Enviar notificação manual' })
  notify(
    @Param('id') id: string,
    @Body() dto: NotifySurgeryRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflowService.notify(id, dto, user.userId);
  }

  @Get(':id/sections')
  @ApiOperation({ summary: 'Listar seções do laudo' })
  getSections(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.surgeryRequestsService.getReportSections(id, user.userId);
  }

  @Post(':id/sections')
  @ApiOperation({ summary: 'Criar seção do laudo' })
  createSection(
    @Param('id') id: string,
    @Body() dto: CreateReportSectionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.createReportSection(
      id,
      dto,
      user.userId,
    );
  }

  @Patch(':id/sections/reorder')
  @ApiOperation({ summary: 'Reordenar seções do laudo' })
  reorderSections(
    @Param('id') id: string,
    @Body() dto: ReorderReportSectionsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.reorderReportSections(
      id,
      dto,
      user.userId,
    );
  }

  @Patch(':id/sections/:sectionId')
  @ApiOperation({ summary: 'Atualizar seção do laudo' })
  updateSection(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
    @Body() dto: UpdateReportSectionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.updateReportSection(
      id,
      sectionId,
      dto,
      user.userId,
    );
  }

  @Delete(':id/sections/:sectionId')
  @ApiOperation({ summary: 'Excluir seção do laudo' })
  deleteSection(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.deleteReportSection(
      id,
      sectionId,
      user.userId,
    );
  }

  @Get(':id/export-pdf')
  @ApiOperation({ summary: 'Exportar PDF da solicitação cirúrgica' })
  async exportSurgeryRequestPdf(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const buffer = await this.workflowService.exportSurgeryRequestPdf(
      id,
      user.userId,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="solicitacao-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.status(HttpStatus.OK).end(buffer);
  }

  @Get(':id/medical-report-pdf')
  @ApiOperation({ summary: 'Gerar PDF do laudo médico (template de laudo)' })
  async getMedicalReportPdf(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const buffer = await this.surgeryRequestsService.generateMedicalReportPdf(
      id,
      user.userId,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="laudo-medico-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.status(HttpStatus.OK).end(buffer);
  }

  @Get('available-doctors')
  @RequirePermission()
  @ApiOperation({ summary: 'Listar médicos disponíveis' })
  getAvailableDoctors(@CurrentUser() user: AuthenticatedUser) {
    return this.surgeryRequestsService.getAvailableDoctors(user.userId);
  }

  @Get('templates')
  @ApiOperation({ summary: 'Listar templates' })
  getTemplates(@CurrentUser() user: AuthenticatedUser) {
    return this.surgeryRequestsService.getTemplates(user.userId, user.ownerId);
  }

  @Post('templates')
  @ApiOperation({ summary: 'Criar template' })
  createTemplate(
    @Body() dto: CreateSurgeryRequestTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.createTemplate(
      dto,
      user.userId,
      user.ownerId,
    );
  }

  @Post('templates/bulk-delete')
  @ApiOperation({ summary: 'Excluir templates em lote' })
  bulkDeleteTemplates(
    @Body() dto: BulkDeleteTemplatesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.bulkDeleteTemplates(
      dto.ids,
      user.userId,
      user.ownerId,
    );
  }

  @Delete('templates/:id')
  @SkipSurgeryOwner()
  @ApiOperation({ summary: 'Excluir template' })
  deleteTemplate(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.deleteTemplate(
      id,
      user.userId,
      user.ownerId,
    );
  }

  @Patch('templates/:id')
  @SkipSurgeryOwner()
  @ApiOperation({ summary: 'Atualizar template' })
  updateTemplate(
    @Param('id') id: string,
    @Body() dto: UpdateSurgeryRequestTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.updateTemplate(
      id,
      dto,
      user.userId,
      user.ownerId,
    );
  }

  @Get('templates/:id')
  @SkipSurgeryOwner()
  @ApiOperation({ summary: 'Detalhar template' })
  getTemplate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.surgeryRequestsService.getTemplate(
      id,
      user.userId,
      user.ownerId,
    );
  }

  @Post('templates/:id/increment-usage')
  @SkipSurgeryOwner()
  @ApiOperation({ summary: 'Incrementar uso do template' })
  incrementTemplateUsage(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.incrementTemplateUsage(
      id,
      user.userId,
      user.ownerId,
    );
  }
}
