import { validate, ValidationError } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreatePatientDto } from '../../../../modules/patients/dto/create-patient.dto';
import { CreateHospitalDto } from '../../../../modules/hospitals/dto/create-hospital.dto';
import { CreateHealthPlanDto } from '../../../../modules/health-plans/dto/create-health-plan.dto';
import { CreateProcedureDto } from '../../../../modules/procedures/dto/create-procedure.dto';
import {
  CreatePatientDraftFields,
  CreateHospitalDraftFields,
  CreateHealthPlanDraftFields,
  CreateProcedureDraftFields,
} from '../../drafts/operation-draft.types';
import {
  normalizeCpfDigits,
  normalizeEmail,
  normalizeBirthDate,
  normalizePhoneDigits,
} from './normalizers';

export interface DtoBuildResult<T> {
  dto: T;
  errors: string[] | null;
}

function collectErrors(errors: ValidationError[]): string[] {
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

const VALIDATE_OPTS = { whitelist: true, forbidNonWhitelisted: false };

export async function buildPatientCreateDto(
  fields: CreatePatientDraftFields,
): Promise<DtoBuildResult<CreatePatientDto>> {
  const dto = plainToInstance(CreatePatientDto, {
    name: fields.name,
    cpf: normalizeCpfDigits(fields.cpf) ?? fields.cpf,
    phone: normalizePhoneDigits(fields.phone) ?? fields.phone ?? undefined,
    email: normalizeEmail(fields.email) ?? fields.email ?? undefined,
    birthDate: fields.birthDate
      ? (normalizeBirthDate(fields.birthDate) ?? fields.birthDate)
      : undefined,
    gender: fields.gender ?? undefined,
  });
  const errors = await validate(dto, VALIDATE_OPTS);
  return { dto, errors: errors.length ? collectErrors(errors) : null };
}

export async function buildHospitalCreateDto(
  fields: CreateHospitalDraftFields,
): Promise<DtoBuildResult<CreateHospitalDto>> {
  const dto = plainToInstance(CreateHospitalDto, { name: fields.name });
  const errors = await validate(dto, VALIDATE_OPTS);
  return { dto, errors: errors.length ? collectErrors(errors) : null };
}

export async function buildHealthPlanCreateDto(
  fields: CreateHealthPlanDraftFields & {
    phone?: string;
    email?: string;
  },
): Promise<DtoBuildResult<CreateHealthPlanDto>> {
  const dto = plainToInstance(CreateHealthPlanDto, {
    name: fields.name,
    phone: fields.phone ?? '',
    email: fields.email ?? '',
  });
  const errors = await validate(dto, VALIDATE_OPTS);
  return { dto, errors: errors.length ? collectErrors(errors) : null };
}

export async function buildProcedureCreateDto(
  fields: CreateProcedureDraftFields,
): Promise<DtoBuildResult<CreateProcedureDto>> {
  const dto = plainToInstance(CreateProcedureDto, { name: fields.name });
  const errors = await validate(dto, VALIDATE_OPTS);
  return { dto, errors: errors.length ? collectErrors(errors) : null };
}
