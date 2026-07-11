import {
  formatCep,
  formatCpf,
  formatDateBR,
  formatPhone,
} from 'src/shared/utils';

export interface LaudoPatientSource {
  patient?: {
    name?: string | null;
    birthDate?: string | Date | null;
    rg?: string | null;
    cpf?: string | null;
    phone?: string | null;
    healthPlanNumber?: string | null;
    address?: string | null;
    addressNumber?: string | null;
    addressComplement?: string | null;
    neighborhood?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
    cep?: string | null;
  } | null;
  healthPlan?: { name?: string | null } | null;
  healthPlanRegistration?: string | null;
}

export interface LaudoPatientFields {
  patientName?: string;
  patientBirthDate?: string;
  patientRg?: string;
  patientCpf?: string;
  patientPhone?: string;
  patientAddress?: string;
  patientZipCode?: string;
  patientHealthPlan?: string;
  patientHealthPlanNumber?: string;
}

const digitsOnly = (value?: string | null): string =>
  value ? value.replace(/\D/g, '') : '';

const filledString = (value?: string | null): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const filledCpf = (value?: string | null): string | undefined => {
  const digits = digitsOnly(value);
  if (digits.length !== 11) return undefined;
  return formatCpf(digits);
};

const filledPhone = (value?: string | null): string | undefined => {
  const digits = digitsOnly(value);
  if (digits.length < 10) return undefined;
  return formatPhone(digits);
};

const filledCep = (value?: string | null): string | undefined => {
  const digits = digitsOnly(value);
  if (digits.length !== 8) return undefined;
  return formatCep(digits);
};

const filledBirthDate = (
  value?: string | Date | null,
): string | undefined => {
  if (!value) return undefined;
  const formatted = formatDateBR(String(value));
  return formatted || undefined;
};

export function formatPatientAddressForLaudo(
  patient: LaudoPatientSource['patient'],
): string | undefined {
  if (!patient) return undefined;

  const parts = [
    patient.address,
    patient.addressNumber,
    patient.addressComplement,
    patient.neighborhood,
    patient.city,
    patient.state,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  return parts.length ? parts.join(', ') : undefined;
}

export function buildLaudoPatientFields(
  request: LaudoPatientSource,
): LaudoPatientFields {
  const patient = request.patient;
  const fields: LaudoPatientFields = {};

  const patientName = filledString(patient?.name);
  if (patientName) fields.patientName = patientName;

  const patientBirthDate = filledBirthDate(patient?.birthDate);
  if (patientBirthDate) fields.patientBirthDate = patientBirthDate;

  const patientRg = filledString(patient?.rg);
  if (patientRg) fields.patientRg = patientRg;

  const patientCpf = filledCpf(patient?.cpf);
  if (patientCpf) fields.patientCpf = patientCpf;

  const patientAddress = formatPatientAddressForLaudo(patient);
  if (patientAddress) fields.patientAddress = patientAddress;

  const patientZipCode = filledCep(patient?.zipCode ?? patient?.cep);
  if (patientZipCode) fields.patientZipCode = patientZipCode;

  const patientPhone = filledPhone(patient?.phone);
  if (patientPhone) fields.patientPhone = patientPhone;

  const patientHealthPlan = filledString(request.healthPlan?.name);
  if (patientHealthPlan) fields.patientHealthPlan = patientHealthPlan;

  const patientHealthPlanNumber =
    filledString(patient?.healthPlanNumber) ??
    filledString(request.healthPlanRegistration);
  if (patientHealthPlanNumber) {
    fields.patientHealthPlanNumber = patientHealthPlanNumber;
  }

  return fields;
}
