import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../shared/decorators/current-user.decorator';
import { Public } from '../../shared/decorator/is-public.decorator';
import { ConsentService } from './consent.service';
import { LegalDocumentsService } from './legal-documents.service';
import { GrantConsentDto } from './dto/grant-consent.dto';
import { RevokeConsentDto } from './dto/revoke-consent.dto';
import { ConsentType } from '../../database/entities/consent-log.entity';
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
  @ApiOperation({ summary: 'Estado dos três consentimentos do usuário.' })
  async getStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.consentService.getStatus(user.userId);
  }

  @Post('consent/grant')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Registrar aceite de um consentimento.' })
  async grant(
    @Body() body: GrantConsentDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.consentService.grant(user.userId, body.type, body.version, {
      ip: this.extractIp(req),
      userAgent: req.headers['user-agent'] || null,
      channel: 'web',
    });
  }

  @Post('consent/revoke')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revogar um consentimento previamente dado.' })
  async revoke(
    @Body() body: RevokeConsentDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.consentService.revoke(user.userId, body.type, {
      ip: this.extractIp(req),
      userAgent: req.headers['user-agent'] || null,
      channel: 'web',
    });
  }

  @Get('consent/history')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Histórico de aceites/revogações do usuário.' })
  async history(
    @CurrentUser() user: AuthenticatedUser,
    @Query('type') type?: ConsentType,
    @Query('limit') limit?: string,
  ) {
    return this.consentService.getHistory(
      user.userId,
      type,
      limit ? Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200) : 50,
    );
  }

  private extractIp(req: Request): string | null {
    const forwarded = (req.headers['x-forwarded-for'] || '') as string;
    if (forwarded) return forwarded.split(',')[0].trim();
    return req.ip || req.socket?.remoteAddress || null;
  }
}
