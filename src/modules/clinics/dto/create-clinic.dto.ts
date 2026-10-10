import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { BusinessHours } from 'src/shared/business-hours/business-hours.types';
import { validateBusinessHours } from 'src/shared/business-hours/business-hours.util';

@ValidatorConstraint({ name: 'businessHours', async: false })
export class BusinessHoursConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return validateBusinessHours(value) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    return validateBusinessHours(args.value) ?? 'Grade de horários inválida.';
  }
}

export class CreateClinicDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional() @IsString() cnpj?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() zipCode?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() addressNumber?: string;
  @IsOptional() @IsString() neighborhood?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;

  @IsOptional()
  @Validate(BusinessHoursConstraint)
  businessHours?: BusinessHours;
}
