import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDecimal,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { AppointmentType } from 'src/database/entities/appointment.entity';

const aparar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const VALOR_NAO_NEGATIVO = /^\d{1,10}(\.\d{1,2})?$/;
export const MENSAGEM_VALOR_INVALIDO =
  'Informe um valor maior ou igual a zero, com até 2 casas decimais';

export class ServicePriceDoctorDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

export class ServicePriceDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: String, nullable: true })
  doctorId: string | null;

  @ApiProperty({ type: ServicePriceDoctorDto, nullable: true })
  doctor: ServicePriceDoctorDto | null;

  @ApiProperty({
    enum: AppointmentType,
    enumName: 'AppointmentType',
    nullable: true,
  })
  appointmentType: AppointmentType | null;

  @ApiProperty()
  description: string;

  @ApiProperty({ example: '300.00' })
  amount: string;

  @ApiProperty()
  active: boolean;
}

export class CreateServicePriceDto {
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsUUID()
  doctorId?: string | null;

  @ApiPropertyOptional({
    enum: AppointmentType,
    enumName: 'AppointmentType',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsEnum(AppointmentType)
  appointmentType?: AppointmentType | null;

  @ApiProperty({ maxLength: 150, example: 'Consulta ortopédica' })
  @Transform(aparar)
  @IsString()
  @IsNotEmpty({ message: 'Informe a descrição do preço' })
  @MaxLength(150)
  description: string;

  @ApiProperty({ example: '300.00' })
  @IsDecimal({ decimal_digits: '0,2' }, { message: MENSAGEM_VALOR_INVALIDO })
  @Matches(VALOR_NAO_NEGATIVO, { message: MENSAGEM_VALOR_INVALIDO })
  amount: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateServicePriceDto {
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsUUID()
  doctorId?: string | null;

  @ApiPropertyOptional({
    enum: AppointmentType,
    enumName: 'AppointmentType',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsEnum(AppointmentType)
  appointmentType?: AppointmentType | null;

  @ApiPropertyOptional({ maxLength: 150 })
  @ValidateIf((_, valor) => valor !== undefined)
  @Transform(aparar)
  @IsString()
  @IsNotEmpty({ message: 'Informe a descrição do preço' })
  @MaxLength(150)
  description?: string;

  @ApiPropertyOptional({ example: '300.00' })
  @ValidateIf((_, valor) => valor !== undefined)
  @IsDecimal({ decimal_digits: '0,2' }, { message: MENSAGEM_VALOR_INVALIDO })
  @Matches(VALOR_NAO_NEGATIVO, { message: MENSAGEM_VALOR_INVALIDO })
  amount?: string;

  @ApiPropertyOptional()
  @ValidateIf((_, valor) => valor !== undefined)
  @IsBoolean()
  active?: boolean;
}

export class ResolveServicePriceQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  doctorId?: string;

  @ApiPropertyOptional({ enum: AppointmentType, enumName: 'AppointmentType' })
  @IsOptional()
  @IsEnum(AppointmentType)
  type?: AppointmentType;
}

export class ResolvedServicePriceDto {
  @ApiProperty({ type: String, nullable: true, example: '300.00' })
  amount: string | null;

  @ApiProperty({ type: String, nullable: true })
  servicePriceId: string | null;
}
