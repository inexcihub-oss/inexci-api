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
import { CreateReportSectionDto } from './dto/create-report-section.dto';
import { UpdateReportSectionDto } from './dto/update-report-section.dto';
import { ReorderReportSectionsDto } from './dto/reorder-report-sections.dto';

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
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.createSurgeryRequest(
      data,
      user.userId,
    );
  }

  // ============================================================
  // LEITURA
  // ============================================================

  @Get()
  findAll(
    @Query() query: FindManySurgeryRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.findAll(query, user.userId);
  }

  @Get('one')
  findOne(
    @Query() query: FindOneSurgeryRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.findOne(query.id, user.userId);
  }

  @Get('date-expired')
  dateExpired() {
    return this.surgeryRequestsService.dateExpired();
  }

  // ============================================================
  // ATUALIZAÇÃO GERAL
  // ============================================================

  @Put()
  update(
    @Body() data: UpdateSurgeryRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.update(data, user.userId);
  }

  @Patch(':id/has-opme')
  setHasOpme(
    @Param('id') id: string,
    @Body() body: { has_opme: boolean },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.setHasOpme(
      id,
      body.has_opme,
      user.userId,
    );
  }

  @Patch(':id/basic')
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

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() data: UpdateStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.updateStatus(
      id,
      data.status,
      user.userId,
      data.notify_patient,
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
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.sendRequest(id, dto, user.userId);
  }

  /**
   * SENT → IN_ANALYSIS
   * Registra início da análise com dados do convênio
   */
  @Post(':id/start-analysis')
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
  async getContestAuthorizationPdf(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: any,
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
  updateDateOptions(
    @Param('id') id: string,
    @Body() dto: UpdateDateOptionsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.updateDateOptions(
      id,
      dto,
      user.userId,
    );
  }

  /**
   * SCHEDULED → SCHEDULED (reagenda sem mudar status)
   */
  @Patch(':id/reschedule')
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
  getSections(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.getReportSections(id, user.userId);
  }

  /** POST /surgery-requests/:id/sections — criar section */
  @Post(':id/sections')
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
   * Gera o PDF do laudo médico e retorna como download
   * GET /surgery-requests/:id/report-pdf
   */
  @Get(':id/report-pdf')
  async getReportPdf(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: any,
  ) {
    const buffer = await this.surgeryRequestsService.generateReportPdf(
      id,
      user.userId,
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
   * GET /surgery-requests/available-doctors
   * Lista os médicos disponíveis para o usuário logado criar solicitações.
   * IMPORTANTE: rota registrada ANTES de ':id/...' para não conflitar.
   */
  @Get('available-doctors')
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
  getTemplates(@CurrentUser() user: AuthenticatedUser) {
    return this.surgeryRequestsService.getTemplates(user.userId);
  }

  /**
   * POST /surgery-requests/templates
   * Cria um novo template de solicitação.
   */
  @Post('templates')
  createTemplate(
    @Body() dto: { name: string; template_data: object },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.createTemplate(dto, user.userId);
  }

  /**
   * DELETE /surgery-requests/templates/:id
   * Exclui um template do médico logado.
   */
  @Delete('templates/:id')
  deleteTemplate(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surgeryRequestsService.deleteTemplate(id, user.userId);
  }
}
