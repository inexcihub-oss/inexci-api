import { Type } from 'class-transformer';
import { IntersectionType, OmitType } from '@nestjs/swagger';
import { IsArray, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { CidCodeDto } from '../../dto/cid-code.dto';
import { CreatePrescriptionDto } from './create-prescription.dto';
import { CreateMedicalCertificateDto } from './create-medical-certificate.dto';
import { CreateExamReferralDto } from './create-exam-referral.dto';

/**
 * De onde a prévia tira paciente e médico.
 *
 * Emitir sempre parte de uma ficha gravada; **pré-visualizar não pode exigir
 * isso**. O médico que clica em "Visualizar" está conferindo, não registrando:
 * criar a ficha só para montar o HTML gravava prontuário vazio (dado sensível,
 * com auditoria LGPD) e, de quebra, travava a exclusão da consulta, que é
 * proibida quando existe ficha vinculada.
 *
 * Por isso `clinicalRecordId` é opcional aqui: sem ele, o documento é montado a
 * partir do paciente e dos campos que estão na tela.
 */
class PreviewTargetDto {
  /** Ficha já gravada. Quando ausente, `patientId` é obrigatório. */
  @IsUUID()
  @IsOptional()
  clinicalRecordId?: string;

  /** Paciente do documento, para a prévia sem ficha gravada. */
  @IsUUID()
  @IsOptional()
  patientId?: string;

  /**
   * Médico que assina o documento. Sem ficha, o padrão é o próprio usuário —
   * que já precisa ser médico para chegar aqui.
   */
  @IsUUID()
  @IsOptional()
  doctorId?: string;
}

export class PreviewPrescriptionDto extends IntersectionType(
  OmitType(CreatePrescriptionDto, ['clinicalRecordId'] as const),
  PreviewTargetDto,
) {}

export class PreviewMedicalCertificateDto extends IntersectionType(
  OmitType(CreateMedicalCertificateDto, ['clinicalRecordId'] as const),
  PreviewTargetDto,
) {
  /**
   * CIDs da ficha em memória. É o que `includeCid` reaproveita quando a ficha
   * ainda não foi gravada — na emissão esse papel é da própria ficha.
   */
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CidCodeDto)
  cidCodes?: CidCodeDto[];
}

export class PreviewExamReferralDto extends IntersectionType(
  OmitType(CreateExamReferralDto, ['clinicalRecordId'] as const),
  PreviewTargetDto,
) {}
