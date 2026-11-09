import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';
import {
  PLATFORM_SECURITY_EVENTS,
  type PlatformSecurityEventType,
} from 'src/database/entities/platform-security-daily.entity';
import { SECURITY_PERIOD_DAYS } from '../security.config';

export class AdminSecurityQueryDto {
  @ApiPropertyOptional({ enum: SECURITY_PERIOD_DAYS, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(SECURITY_PERIOD_DAYS)
  days?: number;
}

export class AdminSecurityTotalsDto {
  @ApiProperty() login_failed: number;
  @ApiProperty() login_locked: number;
  @ApiProperty() mfa_failed: number;
  @ApiProperty() refresh_reuse: number;
  @ApiProperty() password_changed: number;
  @ApiProperty() mfa_enabled: number;
  @ApiProperty() mfa_disabled: number;
}

export class AdminSecurityDayDto {
  @ApiProperty({ example: '2026-10-28' }) day: string;
  @ApiProperty({ enum: PLATFORM_SECURITY_EVENTS })
  eventType: PlatformSecurityEventType;
  @ApiProperty() total: number;
}

export class AdminSecurityAccountDto {
  @ApiProperty() ownerId: string;
  @ApiProperty({ type: String, nullable: true }) ownerName: string | null;
  @ApiProperty() total: number;
  @ApiProperty() users: number;
  @ApiProperty({ type: String, format: 'date-time' }) lastSeenAt: Date;
}

export class AdminMfaCoverageDto {
  @ApiProperty() activeUsers: number;
  @ApiProperty() withoutMfa: number;
}

export class AdminSecuritySpikeDto {
  @ApiProperty({
    description:
      'Falhas de login em 24 h a partir das quais a conta entra no alerta',
  })
  accountThreshold: number;
  @ApiProperty({
    description:
      'Falhas de login em 24 h na plataforma toda que indicam ataque',
  })
  platformThreshold: number;
  @ApiProperty() platformTotal24h: number;
  @ApiProperty() platformSpike: boolean;
  @ApiProperty() accountsWithSpike24h: number;
  @ApiProperty({ type: [AdminSecurityAccountDto] })
  topSpikeAccounts: AdminSecurityAccountDto[];
}

export class AdminSecurityOverviewDto {
  @ApiProperty() fromDay: string;
  @ApiProperty() toDay: string;
  @ApiProperty({ type: AdminSecurityTotalsDto }) totals: AdminSecurityTotalsDto;
  @ApiProperty({
    description:
      'Bloqueios de login para e-mails que não são de nenhum usuário',
  })
  unattributedLocks: number;
  @ApiProperty({ type: [AdminSecurityDayDto] }) daily: AdminSecurityDayDto[];
  @ApiProperty({ type: [AdminSecurityAccountDto] })
  failureAccounts: AdminSecurityAccountDto[];
  @ApiProperty({ type: [AdminSecurityAccountDto] })
  reuseAccounts: AdminSecurityAccountDto[];
  @ApiProperty({ type: AdminMfaCoverageDto }) mfa: AdminMfaCoverageDto;
  @ApiProperty({ type: AdminSecuritySpikeDto }) spike: AdminSecuritySpikeDto;
  @ApiProperty() lokiAvailable: boolean;
}

export class AdminSecurityUserDto {
  @ApiProperty() userId: string;
  @ApiProperty({ type: String, nullable: true }) userName: string | null;
  @ApiProperty({ type: AdminSecurityTotalsDto }) events: AdminSecurityTotalsDto;
  @ApiProperty({
    description: 'Senha errada, login bloqueado e código MFA errado',
  })
  failures: number;
  @ApiProperty({
    description:
      'Reuso de token, troca de senha e MFA desligado (derrubam as sessões)',
  })
  sessionsRevoked: number;
  @ApiProperty({ type: String, format: 'date-time' }) lastSeenAt: Date;
}

export class AdminAccountSecurityDto {
  @ApiProperty() ownerId: string;
  @ApiProperty() fromDay: string;
  @ApiProperty() toDay: string;
  @ApiProperty({ type: AdminSecurityTotalsDto }) totals: AdminSecurityTotalsDto;
  @ApiProperty({ type: [AdminSecurityDayDto] }) daily: AdminSecurityDayDto[];
  @ApiProperty({ type: [AdminSecurityUserDto] }) users: AdminSecurityUserDto[];
  @ApiProperty({ type: AdminMfaCoverageDto }) mfa: AdminMfaCoverageDto;
  @ApiProperty() lokiAvailable: boolean;
}

export class AdminSecurityLogLineDto {
  @ApiProperty({ type: String, format: 'date-time' }) timestamp: Date;
  @ApiProperty({ type: String, nullable: true }) level: string | null;
  @ApiProperty() message: string;
  @ApiProperty({ type: String, nullable: true }) requestId: string | null;
}

export class AdminAccountSecurityLogsDto {
  @ApiProperty({ type: [AdminSecurityLogLineDto] })
  logs: AdminSecurityLogLineDto[];
  @ApiProperty() lokiAvailable: boolean;
  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['not_configured', 'unavailable'],
  })
  lokiError: 'not_configured' | 'unavailable' | null;
}
