import {
  Controller,
  Get,
  Post,
  Body,
  Request,
  Query,
  Put,
  Patch,
  Param,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { SurgeryRequestsService } from './surgery-requests.service';

// DTOs gerais
import { CreateSurgeryRequestSimpleDto } from './dto/create-surgery-request-simple.dto';
import { FindManySurgeryRequestDto } from './dto/find-many.dto';
import { FindOneSurgeryRequestDto } from './dto/find-one.dto';
import { UpdateSurgeryRequestDto } from './dto/update-surgery-request.dto';
import { UpdateSurgeryRequestBasicDto } from './dto/update-surgery-request-basic.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

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

@Controller('surgery-requests')
export class SurgeryRequestsController {
  constructor(
    private readonly surgeryRequestsService: SurgeryRequestsService,
  ) {}

  // ============================================================
  // CRIAÇÃO
  // ============================================================

  @Post()
  createSurgeryRequest(
    @Body() data: CreateSurgeryRequestSimpleDto,
    @Request() req,
  ) {
    return this.surgeryRequestsService.createSurgeryRequest(
      data,
      req.user.userId,
    );
  }

  // ============================================================
  // LEITURA
  // ============================================================

  @Get()
  findAll(@Query() query: FindManySurgeryRequestDto, @Request() req) {
    return this.surgeryRequestsService.findAll(query, req.user.userId);
  }

  @Get('one')
  findOne(@Query() query: FindOneSurgeryRequestDto, @Request() req) {
    return this.surgeryRequestsService.findOne(query.id, req.user.userId);
  }

  @Get('date-expired')
  dateExpired(@Request() req) {
    return this.surgeryRequestsService.dateExpired();
  }

  // ============================================================
  // ATUALIZAÇÃO GERAL
  // ============================================================

  @Put()
  update(@Body() data: UpdateSurgeryRequestDto, @Request() req) {
    return this.surgeryRequestsService.update(data, req.user.userId);
  }

  @Patch(':id/has-opme')
  setHasOpme(
    @Param('id') id: string,
    @Body() body: { has_opme: boolean },
    @Request() req,
  ) {
    return this.surgeryRequestsService.setHasOpme(
      id,
      body.has_opme,
      req.user.userId,
    );
  }

  @Patch(':id/basic')
  updateBasic(
    @Param('id') id: string,
    @Body() data: UpdateSurgeryRequestBasicDto,
    @Request() req,
  ) {
    return this.surgeryRequestsService.updateBasic(
      { ...data, id },
      req.user.userId,
    );
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() data: UpdateStatusDto,
    @Request() req,
  ) {
    return this.surgeryRequestsService.updateStatus(
      id,
      data.status,
      req.user.userId,
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
  sendRequest(
    @Param('id') id: string,
    @Body() dto: SendRequestDto,
    @Request() req,
  ) {
    return this.surgeryRequestsService.sendRequest(id, dto, req.user.userId);
  }

  /**
   * SENT → IN_ANALYSIS
   * Registra início da análise com dados do convênio
   */
  @Post(':id/start-analysis')
  startAnalysis(
    @Param('id') id: string,
    @Body() dto: StartAnalysisDto,
    @Request() req,
  ) {
    return this.surgeryRequestsService.startAnalysis(id, dto, req.user.userId);
  }

  /**
   * IN_ANALYSIS → IN_SCHEDULING
   * Aceita a autorização do convênio e fornece opções de data
   */
  @Post(':id/accept-authorization')
  acceptAuthorization(
    @Param('id') id: string,
    @Body() dto: AcceptAuthorizationDto,
    @Request() req,
  ) {
    return this.surgeryRequestsService.acceptAuthorization(
      id,
      dto,
      req.user.userId,
    );
  }

  /**
   * IN_ANALYSIS → IN_ANALYSIS (não muda status)
   * Contesta a negativa de autorização
   */
  @Post(':id/contest-authorization')
  contestAuthorization(
    @Param('id') id: string,
    @Body() dto: ContestAuthorizationDto,
    @Request() req,
  ) {
    return this.surgeryRequestsService.contestAuthorization(
      id,
      dto,
      req.user.userId,
    );
  }

  /**
   * Gera o PDF da contestação à negativa de autorização e retorna como download
   * GET /surgery-requests/:id/contest-authorization-pdf
   */
  @Get(':id/contest-authorization-pdf')
  async getContestAuthorizationPdf(
    @Param('id') id: string,
    @Request() req,
    @Res() res: any,
  ) {
    const buffer =
      await this.surgeryRequestsService.generateContestAuthorizationPdf(
        id,
        req.user.userId,
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
  confirmDate(
    @Param('id') id: string,
    @Body() dto: ConfirmDateDto,
    @Request() req,
  ) {
    return this.surgeryRequestsService.confirmDate(id, dto, req.user.userId);
  }

  /**
   * IN_SCHEDULING → IN_SCHEDULING (atualiza opções de data sem mudar status)
   */
  @Patch(':id/date-options')
  updateDateOptions(
    @Param('id') id: string,
    @Body() dto: UpdateDateOptionsDto,
    @Request() req,
  ) {
    return this.surgeryRequestsService.updateDateOptions(
      id,
      dto,
      req.user.userId,
    );
  }

  /**
   * SCHEDULED → SCHEDULED (reagenda sem mudar status)
   */
  @Patch(':id/reschedule')
  reschedule(
    @Param('id') id: string,
    @Body() dto: RescheduleDto,
    @Request() req,
  ) {
    return this.surgeryRequestsService.reschedule(id, dto, req.user.userId);
  }

  /**
   * SCHEDULED → PERFORMED
   * Marca como realizada após a cirurgia
   */
  @Post(':id/mark-performed')
  markPerformed(
    @Param('id') id: string,
    @Body() dto: MarkPerformedDto,
    @Request() req,
  ) {
    return this.surgeryRequestsService.markPerformed(id, dto, req.user.userId);
  }

  /**
   * PERFORMED → INVOICED
   * Registra o faturamento enviado ao convênio
   */
  @Post(':id/invoice')
  invoiceRequest(
    @Param('id') id: string,
    @Body() dto: InvoiceRequestDto,
    @Request() req,
  ) {
    return this.surgeryRequestsService.invoiceRequest(id, dto, req.user.userId);
  }

  /**
   * INVOICED → FINALIZED
   * Confirma o recebimento do pagamento
   */
  @Post(':id/confirm-receipt')
  confirmReceipt(
    @Param('id') id: string,
    @Body() dto: ConfirmReceiptDto,
    @Request() req,
  ) {
    return this.surgeryRequestsService.confirmReceipt(id, dto, req.user.userId);
  }

  /**
   * FINALIZED → FINALIZED (não muda status)
   * Contesta divergência de pagamento
   */
  @Post(':id/contest-payment')
  contestPayment(
    @Param('id') id: string,
    @Body() dto: ContestPaymentDto,
    @Request() req,
  ) {
    return this.surgeryRequestsService.contestPayment(id, dto, req.user.userId);
  }

  /**
   * FINALIZED → FINALIZED (edita recebimento após contestação)
   */
  @Patch(':id/billing/receipt')
  updateReceipt(
    @Param('id') id: string,
    @Body() dto: UpdateReceiptDto,
    @Request() req,
  ) {
    return this.surgeryRequestsService.updateReceipt(id, dto, req.user.userId);
  }

  /**
   * ANY → CLOSED (exceto FINALIZED e CLOSED)
   * Fecha/arquiva a solicitação
   */
  @Post(':id/close')
  closeSurgeryRequest(
    @Param('id') id: string,
    @Body() dto: CloseSurgeryRequestDto,
    @Request() req,
  ) {
    return this.surgeryRequestsService.closeSurgeryRequest(
      id,
      dto,
      req.user.userId,
    );
  }

  /**
   * ANY — Envia manualmente um e-mail de notificação
   */
  @Post(':id/notify')
  notify(
    @Param('id') id: string,
    @Body() dto: NotifySurgeryRequestDto,
    @Request() req,
  ) {
    return this.surgeryRequestsService.notify(id, dto, req.user.userId);
  }

  // ============================================================
  // PDF DO LAUDO MÉDICO
  // ============================================================

  /**
   * Gera o PDF do laudo médico e retorna como download
   * GET /surgery-requests/:id/report-pdf
   */
  @Get(':id/report-pdf')
  async getReportPdf(@Param('id') id: string, @Request() req, @Res() res: any) {
    const buffer = await this.surgeryRequestsService.generateReportPdf(
      id,
      req.user.userId,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="laudo-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.status(HttpStatus.OK).end(buffer);
  }

  // ============================================================
  // TEMPLATES DE SOLICITAÇÃO
  // ============================================================

  /**
   * GET /surgery-requests/templates
   * Lista os templates salvos do médico logado.
   * IMPORTANTE: Esta rota deve ser registrada ANTES de ':id/...' para não ser
   * capturada pelo guard de parâmetro dinâmico.
   */
  @Get('templates')
  getTemplates(@Request() req) {
    return this.surgeryRequestsService.getTemplates(req.user.userId);
  }

  /**
   * POST /surgery-requests/templates
   * Cria um novo template de solicitação.
   */
  @Post('templates')
  createTemplate(
    @Body() dto: { name: string; template_data: object },
    @Request() req,
  ) {
    return this.surgeryRequestsService.createTemplate(dto, req.user.userId);
  }
}
