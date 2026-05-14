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

/**
 * Constrói e valida um `CreatePatientDto` a partir dos campos do rascunho de
 * paciente. Aplica normalização de CPF, telefone, e-mail e data de nascimento.
 *
 * Nota: `email` é obrigatório no DTO REST mas opcional no fluxo de IA
 * (o LLM pode omiti-lo). Quando ausente, passa `''` e deixa a validação REST
 * rejeitar — ou informe `skipEmail: true` para pular o campo.
 */
export async function buildPatientCreateDto(
  fields: CreatePatientDraftFields,
): Promise<DtoBuildResult<CreatePatientDto>> {
  const dto = plainToInstance(CreatePatientDto, {
    name: fields.name,
    phone: normalizePhoneDigits(fields.phone) ?? fields.phone ?? '',
    email: normalizeEmail(fields.email) ?? fields.email ?? '',
    cpf: fields.cpf
      ? (normalizeCpfDigits(fields.cpf) ?? fields.cpf)
      : undefined,
    birthDate: fields.birthDate
      ? (normalizeBirthDate(fields.birthDate) ?? fields.birthDate)
      : undefined,
    gender: fields.gender ?? undefined,
  });
  const errors = await validate(dto, VALIDATE_OPTS);
  return { dto, errors: errors.length ? collectErrors(errors) : null };
}

/**
 * Constrói e valida um `CreateHospitalDto` a partir do rascunho de hospital.
 */
export async function buildHospitalCreateDto(
  fields: CreateHospitalDraftFields,
): Promise<DtoBuildResult<CreateHospitalDto>> {
  const dto = plainToInstance(CreateHospitalDto, { name: fields.name });
  const errors = await validate(dto, VALIDATE_OPTS);
  return { dto, errors: errors.length ? collectErrors(errors) : null };
}

/**
 * Constrói e valida um `CreateHealthPlanDto` a partir do rascunho de convênio.
 *
 * O fluxo de IA captura apenas o `name`. Os campos `phone` e `email` são
 * obrigatórios no DTO REST mas o rascunho não os coleta — passamos `''` para
 * que o validator REST rejeite se o service não aceitar dados incompletos, ou
 * podemos estender o rascunho para coletá-los.
 *
 * Na prática, `HealthPlansService.create` aceita phone/email sem validação
 * estrita de formato (só @IsNotEmpty). Para criação via IA, é comum passar
 * placeholder e atualizar depois via REST ou deixar em branco quando o
 * convênio é criado como rascunho interno.
 */
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

/**
 * Constrói e valida um `CreateProcedureDto` a partir do rascunho de procedimento.
 */
export async function buildProcedureCreateDto(
  fields: CreateProcedureDraftFields,
): Promise<DtoBuildResult<CreateProcedureDto>> {
  const dto = plainToInstance(CreateProcedureDto, { name: fields.name });
  const errors = await validate(dto, VALIDATE_OPTS);
  return { dto, errors: errors.length ? collectErrors(errors) : null };
}
