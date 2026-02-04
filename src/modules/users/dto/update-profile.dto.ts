import { Transform } from 'class-transformer';
import { Mask } from '@tboerc/maskfy';
import {
  IsOptional,
  IsString,
  IsNotEmpty,
  IsIn,
  IsDateString,
} from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value ? Mask.phone.raw(value) : value))
  phone?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value ? Mask.cpf.raw(value) : value))
  cpf?: string;

  @IsOptional()
  @IsDateString()
  birth_date?: string;

  @IsOptional()
  @IsString()
  @IsIn(['M', 'F', 'O', ''])
  gender?: string;

  @IsOptional()
  @IsString()
  specialty?: string;

  @IsOptional()
  @IsString()
  crm?: string;

  @IsOptional()
  @IsString()
  @IsIn([
    '',
    'AC',
    'AL',
    'AP',
    'AM',
    'BA',
    'CE',
    'DF',
    'ES',
    'GO',
    'MA',
    'MT',
    'MS',
    'MG',
    'PA',
    'PB',
    'PR',
    'PE',
    'PI',
    'RJ',
    'RN',
    'RS',
    'RO',
    'RR',
    'SC',
    'SP',
    'SE',
    'TO',
  ])
  crm_state?: string;

  @IsOptional()
  @IsString()
  avatar_url?: string;

  @IsOptional()
  @IsString()
  signature_url?: string;
}
