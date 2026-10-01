import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreatePatientDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  /**
   * Opcional: estrangeiros, menores e pacientes migrados de outros sistemas
   * podem não ter. A Solicitação Cirúrgica continua exigindo CPF para avançar.
   */
  @IsOptional()
  @IsString()
  cpf?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  /** Telefone adicional (fixo, recado). */
  @IsOptional()
  @IsString()
  @MaxLength(15)
  secondaryPhone?: string;

  /**
   * Caminho no storage devolvido por `POST /upload/single` com
   * `folder=patient-photos`. `null` remove a foto.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  photoPath?: string | null;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsIn(['M', 'F', 'm', 'f'])
  gender?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional() @IsString() healthPlanId?: string;
  @IsOptional() @IsString() healthPlanNumber?: string;
  @IsOptional() @IsString() healthPlanType?: string;
  @IsOptional() @IsString() zipCode?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() addressNumber?: string;
  @IsOptional() @IsString() addressComplement?: string;
  @IsOptional() @IsString() neighborhood?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() medicalNotes?: string;
}
