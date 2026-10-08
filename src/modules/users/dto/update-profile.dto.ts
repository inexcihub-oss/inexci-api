import { Transform } from 'class-transformer';
import { Mask } from '@tboerc/maskfy';
import {
  IsOptional,
  IsString,
  IsNotEmpty,
  IsIn,
  IsDateString,
  Matches,
} from 'class-validator';
import { PhoneTransform } from 'src/shared/pipes/phone-mask.pipe';

/**
 * Assinatura/carimbo: caminho no bucket, nas pastas `signatures/` ou
 * `stamps/`. URL absoluta não é mais aceita — o perfil guarda o caminho e o
 * backend assina na leitura.
 */
export const SIGNATURE_PATH_REGEX = /^(signatures|stamps)\/[^/]+\/[^/]+$/;
export const SIGNATURE_PATH_MESSAGE =
  'a assinatura deve ser um caminho da pasta de assinaturas';

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
  birthDate?: string;

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
  crmState?: string;

  /**
   * Caminho devolvido pelo `POST /upload/single` (pasta `avatars`). A pasta
   * da conta (`avatars/<ownerId>/`) é conferida no service.
   */
  @IsOptional()
  @Transform(({ value }) => value ?? null)
  @IsString()
  @Matches(/^(avatars\/.+)?$/, {
    message: 'avatarUrl deve ser um caminho da pasta de avatares',
  })
  avatarUrl?: string | null;

  /**
   * Caminho devolvido pelo `POST /upload/single` (pasta `signatures` ou
   * `stamps`). A pasta da conta é conferida no service.
   */
  @IsOptional()
  @Transform(({ value }) => value ?? null)
  @IsString()
  @Matches(SIGNATURE_PATH_REGEX, { message: SIGNATURE_PATH_MESSAGE })
  signatureUrl?: string | null;

  @IsOptional()
  @IsString()
  cep?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  addressNumber?: string;

  @IsOptional()
  @IsString()
  addressComplement?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;
}
