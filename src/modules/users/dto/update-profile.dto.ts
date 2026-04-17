import { Transform } from 'class-transformer';
import { Mask } from '@tboerc/maskfy';
import {
  IsOptional,
  IsString,
  IsNotEmpty,
  IsIn,
  IsDateString,
} from 'class-validator';
import { PhoneTransform } from 'src/shared/pipes/phone-mask.pipe';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @PhoneTransform()
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
  @Transform(({ value }) => value ?? null)
  avatar_url?: string | null;

  @IsOptional()
  @Transform(({ value }) => value ?? null)
  signature_url?: string | null;

  @IsOptional()
  @IsString()
  cep?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  address_number?: string;

  @IsOptional()
  @IsString()
  address_complement?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;
}
