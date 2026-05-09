import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../shared/decorators/current-user.decorator';
import { Public } from '../../shared/decorator/is-public.decorator';
import { ConsentService } from './consent.service';
import { LegalDocumentsService } from './legal-documents.service';
import { SkipConsentCheck } from '../../shared/decorators/skip-consent-check.decorator';

@ApiTags('Privacidade')
@Controller('privacy')
@SkipConsentCheck()
export class PrivacyController {
  constructor(
    private readonly consentService: ConsentService,
    private readonly legalDocsService: LegalDocumentsService,
  ) {}

  // ============ ENDPOINTS PÚBLICOS ============

  @Public()
  @Get('policy/:slug')
  @ApiOperation({
    summary:
      'Conteúdo atual de um documento legal (privacy-policy, terms-of-use, ai-disclosure).',
  })
  async getCurrentDocument(@Param('slug') slug: string) {
    return this.legalDocsService.getCurrent(slug);
  }

  // ============ ENDPOINTS AUTENTICADOS ============

  @Get('consent/status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Estado dos consentimentos do usuário.' })
  async getStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.consentService.getStatus(user.userId);
  }

  @Post('consent/accept-terms')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Aceitar Política de Privacidade e Termos de Uso (em conjunto).',
  })
  async acceptTerms(@CurrentUser() user: AuthenticatedUser) {
    return this.consentService.acceptTerms(user.userId);
  }

  @Post('consent/grant-ai')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Ativar uso do assistente de IA via WhatsApp.' })
  async grantAi(@CurrentUser() user: AuthenticatedUser) {
    return this.consentService.grantAi(user.userId);
  }

  @Post('consent/revoke-ai')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Desativar uso do assistente de IA via WhatsApp.' })
  async revokeAi(@CurrentUser() user: AuthenticatedUser) {
    return this.consentService.revokeAi(user.userId);
  }
}
