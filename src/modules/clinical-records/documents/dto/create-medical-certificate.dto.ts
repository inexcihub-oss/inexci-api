import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CidCodeDto } from '../../dto/cid-code.dto';

export class CreateMedicalCertificateDto {
  /** Ficha de atendimento que origina o atestado. */
  @IsUUID()
  @IsNotEmpty()
  clinicalRecordId: string;

  /** Dias de afastamento. Ausente = atestado de comparecimento. */
  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  restDays?: number;

  /** Início do afastamento (ISO). Default de leitura: a data de emissão. */
  @IsDateString()
  @IsOptional()
  startDate?: string;

  /**
   * Reaproveita o CID da ficha quando nenhum é informado em `cid`. Exige
   * autorização do paciente — o CID revela o diagnóstico a quem receber o
   * documento.
   */
  @IsBoolean()
  @IsOptional()
  includeCid?: boolean;

  /**
   * CID escolhido para este atestado. Tem precedência sobre `includeCid`: o
   * motivo do afastamento nem sempre é a hipótese registrada na ficha.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => CidCodeDto)
  cid?: CidCodeDto;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  observations?: string;
}
