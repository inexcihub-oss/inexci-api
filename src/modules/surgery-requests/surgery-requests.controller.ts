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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { SurgeryRequestsService } from './surgery-requests.service';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';

// DTOs gerais
import { CreateSurgeryRequestSimpleDto } from './dto/create-surgery-request-simple.dto';
import { FindManySurgeryRequestDto } from './dto/find-many.dto';
import { FindOneSurgeryRequestDto } from './dto/find-one.dto';
import { UpdateSurgeryRequestDto } from './dto/update-surgery-request.dto';
import { UpdateSurgeryRequestBasicDto } from './dto/update-surgery-request-basic.dto';

// DTOs de transição
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

@ApiTags('Solicitações Cirúrgicas')
@ApiBearerAuth()
@Controller('surgery-requests')
export class SurgeryRequestsController {
  constructor(
    private readonly surgeryRequestsService: SurgeryRequestsService,
  ) {}

  // ============================================================
  // CRIAÇÃO
  // ============================================================

  @Post()
  @Throttle({ short: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Criar solicitação cirúrgica' })
  createSurgeryRequest(
    @Body() data: CreateSurgeryRequestSimpleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.createSurgeryRequest(data, user.userId);
  }

  // ============================================================
  // LEITURA
  // ============================================================

  @Get()
  @ApiOperation({ summary: 'Listar solicitações cirúrgicas' })
  findAll(
    @Query() query: FindManySurgeryRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.findAll(query, user.userId);
  }

  @Get('one')
  @ApiOperation({ summary: 'Buscar solicitação por ID' })
  findOne(
    @Query() query: FindOneSurgeryRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.findOne(query.id, user.userId);
  }

  // ============================================================
  // ATUALIZAÇÃO GERAL
  // ============================================================

  @Put()
  @ApiOperation({ summary: 'Atualizar solicitação cirúrgica' })
  update(
    @Body() data: UpdateSurgeryRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.update(data, user.userId);
  }

  @Patch(':id/has-opme')
  @ApiOperation({ summary: 'Definir se possui OPME' })
  setHasOpme(
    @Param('id') id: string,
    @Body() body: { hasOpme: boolean },
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

  // ============================================================
  // TRANSIÇÕES DE STATUS
  // ============================================================

  /**
   * PENDING → SENT
   * Envia a solicitação ao convênio
   */
  @Post(':id/send')
  @ApiOperation({ summary: 'Enviar solicitação ao convênio' })
  sendRequest(
    @Param('id') id: string,
    @Body() dto: SendRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.sendRequest(id, dto, user.userId);
  }

  /**
   * SENT → IN_ANALYSIS
   * Registra início da análise com dados do convênio
   */
  @Post(':id/start-analysis')
  @ApiOperation({ summary: 'Iniciar análise' })
  startAnalysis(
    @Param('id') id: string,
    @Body() dto: StartAnalysisDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.startAnalysis(id, dto, user.userId);
  }

  /**
   * IN_ANALYSIS → IN_SCHEDULING
   * Aceita a autorização do convênio e fornece opções de data
   */
  @Post(':id/accept-authorization')
  @ApiOperation({ summary: 'Aceitar autorização' })
  acceptAuthorization(
    @Param('id') id: string,
    @Body() dto: AcceptAuthorizationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.acceptAuthorization(
      id,
      dto,
      user.userId,
    );
  }

  /**
   * IN_ANALYSIS → IN_ANALYSIS (não muda status)
   * Contesta a negativa de autorização
   */
  @Post(':id/contest-authorization')
  @ApiOperation({ summary: 'Contestar autorização' })
  contestAuthorization(
    @Param('id') id: string,
    @Body() dto: ContestAuthorizationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.contestAuthorization(
      id,
      dto,
      user.userId,
    );
  }

  /**
   * Gera o PDF da contestação à negativa de autorização e retorna como download
   * GET /surgery-requests/:id/contest-authorization-pdf
   */
  @Get(':id/contest-authorization-pdf')
  @ApiOperation({ summary: 'Gerar PDF de contestação' })
  async getContestAuthorizationPdf(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const buffer =
      await this.surgeryRequestsService.generateContestAuthorizationPdf(
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

  /**
   * IN_SCHEDULING → SCHEDULED
   * Confirma a data escolhida pelo paciente
   */
  @Post(':id/confirm-date')
  @ApiOperation({ summary: 'Confirmar data da cirurgia' })
  confirmDate(
    @Param('id') id: string,
    @Body() dto: ConfirmDateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.confirmDate(id, dto, user.userId);
  }

  /**
   * IN_SCHEDULING → IN_SCHEDULING (atualiza opções de data sem mudar status)
   */
  @Patch(':id/date-options')
  @ApiOperation({ summary: 'Atualizar opções de data' })
  updateDateOptions(
    @Param('id') id: string,
    @Body() dto: UpdateDateOptionsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.updateDateOptions(id, dto, user.userId);
  }

  /**
   * SCHEDULED → SCHEDULED (reagenda sem mudar status)
   */
  @Patch(':id/reschedule')
  @ApiOperation({ summary: 'Reagendar cirurgia' })
  reschedule(
    @Param('id') id: string,
    @Body() dto: RescheduleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.reschedule(id, dto, user.userId);
  }

  /**
   * SCHEDULED → PERFORMED
   * Marca como realizada após a cirurgia
   */
  @Post(':id/mark-performed')
  @ApiOperation({ summary: 'Marcar como realizada' })
  markPerformed(
    @Param('id') id: string,
    @Body() dto: MarkPerformedDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.markPerformed(id, dto, user.userId);
  }

  /**
   * PERFORMED → INVOICED
   * Registra o faturamento enviado ao convênio
   */
  @Post(':id/invoice')
  @ApiOperation({ summary: 'Faturar solicitação' })
  invoiceRequest(
    @Param('id') id: string,
    @Body() dto: InvoiceRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.invoiceRequest(id, dto, user.userId);
  }

  /**
   * INVOICED → FINALIZED
   * Confirma o recebimento do pagamento
   */
  @Post(':id/confirm-receipt')
  @ApiOperation({ summary: 'Confirmar recebimento' })
  confirmReceipt(
    @Param('id') id: string,
    @Body() dto: ConfirmReceiptDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.confirmReceipt(id, dto, user.userId);
  }

  /**
   * FINALIZED → FINALIZED (não muda status)
   * Contesta divergência de pagamento
   */
  @Post(':id/contest-payment')
  @ApiOperation({ summary: 'Contestar pagamento' })
  contestPayment(
    @Param('id') id: string,
    @Body() dto: ContestPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.contestPayment(id, dto, user.userId);
  }

  /**
   * FINALIZED → FINALIZED (edita recebimento após contestação)
   */
  @Patch(':id/billing/receipt')
  @ApiOperation({ summary: 'Atualizar recebimento' })
  updateReceipt(
    @Param('id') id: string,
    @Body() dto: UpdateReceiptDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.updateReceipt(id, dto, user.userId);
  }

  /**
   * ANY → CLOSED (exceto FINALIZED e CLOSED)
   * Fecha/arquiva a solicitação
   */
  @Post(':id/close')
  @ApiOperation({ summary: 'Encerrar solicitação' })
  closeSurgeryRequest(
    @Param('id') id: string,
    @Body() dto: CloseSurgeryRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.closeSurgeryRequest(
      id,
      dto,
      user.userId,
    );
  }

  /**
   * ANY — Envia manualmente um e-mail de notificação
   */
  @Post(':id/notify')
  @ApiOperation({ summary: 'Enviar notificação manual' })
  notify(
    @Param('id') id: string,
    @Body() dto: NotifySurgeryRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.notify(id, dto, user.userId);
  }

  // ============================================================
  // SEÇÕES DO LAUDO MÉDICO (CRUD)
  // ============================================================

  /** GET /surgery-requests/:id/sections — listar sections ordenadas */
  @Get(':id/sections')
  @ApiOperation({ summary: 'Listar seções do laudo' })
  getSections(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.surgeryRequestsService.getReportSections(id, user.userId);
  }

  /** POST /surgery-requests/:id/sections — criar section */
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

  /** PATCH /surgery-requests/:id/sections/reorder — reordenar sections */
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

  /** PATCH /surgery-requests/:id/sections/:sectionId — editar section */
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

  /** DELETE /surgery-requests/:id/sections/:sectionId — remover section */
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

  // ============================================================
  // PDF DO LAUDO MÉDICO
  // ============================================================

  /**
   * Exporta o PDF da solicitação cirúrgica sem alterar o status.
   * Disponível para solicitações já enviadas (status ≥ 2).
   * GET /surgery-requests/:id/export-pdf
   */
  @Get(':id/export-pdf')
  @ApiOperation({ summary: 'Exportar PDF da solicitação cirúrgica' })
  async exportSurgeryRequestPdf(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const buffer = await this.surgeryRequestsService.exportSurgeryRequestPdf(
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

  /**
   * Gera o PDF do Laudo Médico usando o mesmo template da pré-visualização
   * GET /surgery-requests/:id/medical-report-pdf
   */
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

  // ============================================================
  // TEMPLATES DE SOLICITAÇÃO
  // ============================================================

  /**
   * GET /surgery-requests/available-doctors
   * Lista os médicos disponíveis para o usuário logado criar solicitações.
   * IMPORTANTE: rota registrada ANTES de ':id/...' para não conflitar.
   */
  @Get('available-doctors')
  @ApiOperation({ summary: 'Listar médicos disponíveis' })
  getAvailableDoctors(@CurrentUser() user: AuthenticatedUser) {
    return this.surgeryRequestsService.getAvailableDoctors(user.userId);
  }

  /**
   * GET /surgery-requests/templates
   * Lista os templates salvos do médico logado.
   * IMPORTANTE: Esta rota deve ser registrada ANTES de ':id/...' para não ser
   * capturada pelo guard de parâmetro dinâmico.
   */
  @Get('templates')
  @ApiOperation({ summary: 'Listar templates' })
  getTemplates(@CurrentUser() user: AuthenticatedUser) {
    return this.surgeryRequestsService.getTemplates(user.userId, user.ownerId);
  }

  /**
   * POST /surgery-requests/templates
   * Cria um novo template de solicitação.
   */
  @Post('templates')
  @ApiOperation({ summary: 'Criar template' })
  createTemplate(
    @Body() dto: { name: string; templateData: object },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.createTemplate(
      dto,
      user.userId,
      user.ownerId,
    );
  }

  /**
   * POST /surgery-requests/templates/bulk-delete
   * Exclui templates em lote do médico logado.
   */
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

  /**
   * DELETE /surgery-requests/templates/:id
   * Exclui um template do médico logado.
   */
  @Delete('templates/:id')
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

  /**
   * PATCH /surgery-requests/templates/:id
   * Atualiza um template do médico logado.
   */
  @Patch('templates/:id')
  @ApiOperation({ summary: 'Atualizar template' })
  updateTemplate(
    @Param('id') id: string,
    @Body() dto: { name?: string; templateData?: object },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.updateTemplate(
      id,
      dto,
      user.userId,
      user.ownerId,
    );
  }

  @Post('templates/:id/increment-usage')
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
