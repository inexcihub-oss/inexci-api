import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches } from 'class-validator';
import { AdminActionReasonDto } from '../../subscriptions/dto/admin-subscription-actions.dto';

export const CLINICAL_ACCESS_PERIOD_DAYS = [7, 30, 90] as const;

export class AdminClinicalAccessQueryDto {
  @ApiPropertyOptional({ enum: CLINICAL_ACCESS_PERIOD_DAYS, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(CLINICAL_ACCESS_PERIOD_DAYS)
  days?: number;
}

export class AdminClinicalAccessExportDto extends AdminActionReasonDto {
  @ApiPropertyOptional({ enum: CLINICAL_ACCESS_PERIOD_DAYS, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(CLINICAL_ACCESS_PERIOD_DAYS)
  days?: number;
}

export const PATIENT_LOOKUP_PATTERN =
  /^([0-9a-f]{10}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export class AdminClinicalAccessPatientDto extends AdminActionReasonDto {
  @ApiProperty({
    description:
      'Código do paciente mostrado no painel (10 caracteres) ou o id completo do paciente informado pela clínica',
  })
  @IsString()
  @Matches(PATIENT_LOOKUP_PATTERN, {
    message: 'Informe o código do paciente ou o id completo dele',
  })
  patient: string;

  @ApiPropertyOptional({ enum: CLINICAL_ACCESS_PERIOD_DAYS, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(CLINICAL_ACCESS_PERIOD_DAYS)
  days?: number;
}

export class AdminClinicalAccessTotalsDto {
  @ApiProperty() total: number;
  @ApiProperty() users: number;
}

export class AdminClinicalAccessActionDto {
  @ApiProperty({ example: 'clinical_record' }) resource: string;
  @ApiProperty({ example: 'read' }) action: string;
  @ApiProperty({ enum: ['http', 'ai', 'system'] }) origin: string;
  @ApiProperty() total: number;
}

export class AdminClinicalAccessUserDto {
  @ApiProperty({ type: String, nullable: true }) userId: string | null;
  @ApiProperty({ type: String, nullable: true }) userName: string | null;
  @ApiProperty() resource: string;
  @ApiProperty() action: string;
  @ApiProperty() total: number;
  @ApiProperty({ type: String, format: 'date-time' }) lastAccessAt: Date;
}

export class AdminClinicalAccessPatientRowDto {
  @ApiProperty({ example: 'a1b2c3d4e5' }) patientRef: string;
  @ApiProperty() total: number;
  @ApiProperty() users: number;
  @ApiProperty({ type: String, format: 'date-time' }) lastAccessAt: Date;
}

export class AdminClinicalAccessEventDto {
  @ApiProperty({ type: String, nullable: true }) userId: string | null;
  @ApiProperty({ type: String, nullable: true }) userName: string | null;
  @ApiProperty() resource: string;
  @ApiProperty() action: string;
  @ApiProperty({ enum: ['http', 'ai', 'system'] }) origin: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

export class AdminClinicalAccessPatientResultDto {
  @ApiProperty() auditLogId: string;
  @ApiProperty({ example: 'a1b2c3d4e5' }) patientRef: string;
  @ApiProperty({ type: String, format: 'date-time' }) from: Date;
  @ApiProperty({ type: String, format: 'date-time' }) to: Date;
  @ApiProperty() limit: number;
  @ApiProperty({ type: [AdminClinicalAccessEventDto] })
  items: AdminClinicalAccessEventDto[];
}

export class AdminClinicalAccessDayDto {
  @ApiProperty({ example: '2026-10-28' }) day: string;
  @ApiProperty() total: number;
}

export class AdminClinicalAccessDto {
  @ApiProperty() ownerId: string;
  @ApiProperty({ type: String, format: 'date-time' }) from: Date;
  @ApiProperty({ type: String, format: 'date-time' }) to: Date;
  @ApiProperty({ type: AdminClinicalAccessTotalsDto })
  totals: AdminClinicalAccessTotalsDto;
  @ApiProperty({ type: [AdminClinicalAccessActionDto] })
  byAction: AdminClinicalAccessActionDto[];
  @ApiProperty({ type: [AdminClinicalAccessUserDto] })
  byUser: AdminClinicalAccessUserDto[];
  @ApiProperty({ type: [AdminClinicalAccessDayDto] })
  daily: AdminClinicalAccessDayDto[];
  @ApiProperty({ type: [AdminClinicalAccessPatientRowDto] })
  byPatient: AdminClinicalAccessPatientRowDto[];
}

export class AdminClinicalAccessExportResultDto {
  @ApiProperty() auditLogId: string;
  @ApiProperty({ type: String, format: 'date-time' }) from: Date;
  @ApiProperty({ type: String, format: 'date-time' }) to: Date;
  @ApiProperty({ type: [AdminClinicalAccessUserDto] })
  items: AdminClinicalAccessUserDto[];
}
