import { ApiProperty } from '@nestjs/swagger';
import {
  PlatformAuditAction,
  PlatformAuditStatus,
} from 'src/database/entities/platform-audit-log.entity';

export class PlatformAuditLogItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Administrador da plataforma que executou a ação',
  })
  actorUserId: string;

  @ApiProperty({ type: String, nullable: true })
  actorName: string | null;

  @ApiProperty({ type: String, nullable: true })
  actorEmail: string | null;

  @ApiProperty({ enum: PlatformAuditAction })
  action: PlatformAuditAction;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  targetOwnerId: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Usuário da clínica afetado ou, nas ações de equipe, o administrador afetado',
  })
  targetUserId: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Nome do administrador afetado nas ações de equipe',
  })
  targetName: string | null;

  @ApiProperty({ type: String, nullable: true })
  reason: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  before: Record<string, unknown> | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  after: Record<string, unknown> | null;

  @ApiProperty({ type: String, nullable: true })
  gatewayRef: string | null;

  @ApiProperty({ enum: PlatformAuditStatus })
  status: PlatformAuditStatus;

  @ApiProperty({ type: String, nullable: true })
  error: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt: Date | null;
}

export class PlatformAuditLogListResponseDto {
  @ApiProperty({ type: [PlatformAuditLogItemDto] })
  items: PlatformAuditLogItemDto[];

  @ApiProperty()
  total: number;
}
