/**
 * Mapeamento explícito de resposta para o detalhe da SC (P11 / item 3.6).
 *
 * Allowlist derivada do contrato tipado do frontend (`surgery-request.types.ts`
 * e `SurgeryRequestDetail`). Relações com escape hatch (`analysis`,
 * `contestations`) ficam pass-through.
 */

import type { CidResponse } from '../cid/cid.service';
import { formatPatientAddressForLaudo } from '../utils/laudo-patient-fields.util';

export interface DetailCidResponse {
  code: string;
  description: string;
}

interface DetailDoctorInput {
  id?: string;
  name?: string;
  avatarUrl?: string | null;
  email?: string;
  phone?: string | null;
  signatureUrl?: string | null;
  doctorProfile?: {
    crm?: string;
    crmState?: string;
    specialty?: string | null;
    signatureUrl?: string | null;
    header?: {
      id?: string;
      logoUrl?: string | null;
      logoPosition?: string;
      contentHtml?: string | null;
    } | null;
  } | null;
}

export interface DetailDoctorResponse {
  id?: string;
  name?: string;
  avatarUrl: string | null;
  email?: string;
  phone?: string | null;
  signatureUrl: string | null;
  doctorProfile: {
    crm?: string;
    crmState?: string;
    specialty: string | null;
    signatureUrl: string | null;
    header: {
      id?: string;
      logoUrl: string | null;
      logoPosition?: string;
      contentHtml: string | null;
    } | null;
  } | null;
}

export function mapDetailDoctor(
  doctor: DetailDoctorInput | null | undefined,
): DetailDoctorResponse | null {
  if (!doctor) return null;

  const profile = doctor.doctorProfile;
  const header = profile?.header;

  return {
    id: doctor.id,
    name: doctor.name,
    avatarUrl: doctor.avatarUrl ?? null,
    email: doctor.email,
    phone: doctor.phone ?? null,
    signatureUrl: doctor.signatureUrl ?? null,
    doctorProfile: profile
      ? {
          crm: profile.crm,
          crmState: profile.crmState,
          specialty: profile.specialty ?? null,
          signatureUrl: profile.signatureUrl ?? null,
          header: header
            ? {
                id: header.id,
                logoUrl: header.logoUrl ?? null,
                logoPosition: header.logoPosition,
                contentHtml: header.contentHtml ?? null,
              }
            : null,
        }
      : null,
  };
}

interface EntityRefInput {
  id?: string | number;
  name?: string;
}

function mapEntityRef(
  entity: EntityRefInput | null | undefined,
): { id: string | number; name: string } | null {
  if (!entity?.id || !entity?.name) return null;
  return { id: entity.id, name: entity.name };
}

interface DetailPatientInput {
  id?: string;
  name?: string;
  cpf?: string;
  birthDate?: Date | string | null;
  phone?: string | null;
  healthPlanNumber?: string | null;
  address?: string | null;
  addressNumber?: string | null;
  addressComplement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  medicalNotes?: string | null;
}

export interface DetailPatientResponse {
  id: string;
  name: string;
  cpf?: string;
  birthDate?: string;
  phone?: string;
  healthPlanNumber?: string;
  address?: string;
  zipCode?: string;
}

function serializePatientBirthDate(
  value: Date | string | null | undefined,
): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? undefined
      : value.toISOString().slice(0, 10);
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  return trimmed;
}

function formatPatientAddress(patient: DetailPatientInput): string | undefined {
  return formatPatientAddressForLaudo(patient);
}

function mapDetailPatient(
  patient: DetailPatientInput | null | undefined,
): DetailPatientResponse | null {
  if (!patient?.id) return null;

  const result: DetailPatientResponse = {
    id: patient.id,
    name: patient.name ?? '',
  };

  const cpf = patient.cpf?.trim();
  if (cpf) result.cpf = cpf;

  const birthDate = serializePatientBirthDate(patient.birthDate);
  if (birthDate) result.birthDate = birthDate;

  const phone = patient.phone?.trim();
  if (phone) result.phone = phone;

  const healthPlanNumber = patient.healthPlanNumber?.trim();
  if (healthPlanNumber) result.healthPlanNumber = healthPlanNumber;

  const address = formatPatientAddress(patient);
  if (address) result.address = address;

  const zipCode = patient.zipCode?.trim();
  if (zipCode) result.zipCode = zipCode;

  return result;
}

function mapDetailTussItems(
  items: Array<{
    id?: string;
    name?: string;
    tussCode?: string;
    quantity?: number;
    authorizedQuantity?: number | null;
  }> | null | undefined,
) {
  if (!items?.length) return [];
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    tussCode: item.tussCode,
    quantity: item.quantity,
    authorizedQuantity: item.authorizedQuantity ?? null,
  }));
}

function mapDetailOpmeItems(
  items:
    | Array<{
        id?: string;
        name?: string;
        description?: string | null;
        quantity?: number;
        authorizedQuantity?: number | null;
        suppliers?: Array<{ id?: string; name?: string }>;
        manufacturers?: Array<{ name?: string }>;
      }>
    | null
    | undefined,
) {
  if (!items?.length) return [];
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description ?? null,
    quantity: item.quantity,
    authorizedQuantity: item.authorizedQuantity ?? null,
    suppliers: (item.suppliers ?? [])
      .filter((s) => s.id && s.name)
      .map((s) => ({ id: s.id!, name: s.name! })),
    manufacturers: (item.manufacturers ?? [])
      .filter((m) => m.name)
      .map((m) => ({ name: m.name! })),
  }));
}

function mapDetailDocuments(
  documents:
    | Array<{
        id?: string;
        key?: string;
        name?: string;
        path?: string;
        uri?: string | null;
        createdAt?: Date | string;
        createdBy?: string;
        createdById?: string;
      }>
    | null
    | undefined,
) {
  if (!documents?.length) return [];
  return documents.map((doc) => ({
    id: doc.id,
    key: doc.key,
    name: doc.name,
    path: doc.path,
    uri: doc.uri ?? null,
    createdAt: doc.createdAt ?? null,
    createdBy: doc.createdBy ?? doc.createdById ?? null,
  }));
}

function mapDetailBilling(
  billing:
    | {
        invoiceValue?: number | string | null;
        invoiceProtocol?: string | null;
        invoiceSentAt?: Date | string | null;
        invoiceNotes?: string | null;
        paymentDeadline?: Date | string | null;
      }
    | null
    | undefined,
) {
  if (!billing) return null;
  return {
    invoiceValue:
      billing.invoiceValue != null ? Number(billing.invoiceValue) : null,
    invoiceProtocol: billing.invoiceProtocol ?? null,
    invoiceSentAt: billing.invoiceSentAt ?? null,
    invoiceNotes: billing.invoiceNotes ?? null,
    paymentDeadline: billing.paymentDeadline ?? null,
  };
}

export interface SurgeryRequestDetailInput {
  id?: string;
  status?: number;
  priority?: number;
  protocol?: string | null;
  createdAt?: Date | string;
  hasOpme?: boolean | null;
  surgeryDate?: Date | string | null;
  surgeryPerformedAt?: Date | string | null;
  closedAt?: Date | string | null;
  closedReason?: string | null;
  cidCode?: string | null;
  dateOptions?: string[] | null;
  selectedDateIndex?: number | null;
  hospitalId?: string | null;
  healthPlanId?: string | null;
  healthPlanRegistration?: string | null;
  healthPlanType?: string | null;
  patient?: DetailPatientInput | null;
  hospital?: EntityRefInput | null;
  healthPlan?: EntityRefInput | null;
  procedure?: EntityRefInput | null;
  tussItems?: Parameters<typeof mapDetailTussItems>[0];
  opmeItems?: Parameters<typeof mapDetailOpmeItems>[0];
  documents?: Parameters<typeof mapDetailDocuments>[0];
  billing?: Parameters<typeof mapDetailBilling>[0];
  analysis?: Record<string, unknown> | null;
  contestations?: unknown[] | null;
}

function mapDetailCid(
  cidCode: string | null,
  resolvedCid?: CidResponse | null,
): DetailCidResponse | null {
  if (!cidCode) return null;
  if (resolvedCid) {
    return {
      code: resolvedCid.code,
      description: resolvedCid.description,
    };
  }
  return { code: cidCode, description: '' };
}

export function mapSurgeryRequestDetail(
  sc: SurgeryRequestDetailInput,
  doctor: DetailDoctorResponse | null,
  receipt: Record<string, unknown> | null,
  resolvedCid?: CidResponse | null,
) {
  const cidCode = sc.cidCode ?? null;
  const cid = mapDetailCid(cidCode, resolvedCid);

  return {
    id: sc.id,
    status: sc.status,
    priority: sc.priority,
    protocol: sc.protocol ?? null,
    createdAt: sc.createdAt,
    hasOpme: sc.hasOpme ?? null,
    surgeryDate: sc.surgeryDate ?? null,
    surgeryPerformedAt: sc.surgeryPerformedAt ?? null,
    closedAt: sc.closedAt ?? null,
    closedReason: sc.closedReason ?? null,
    cid,
    dateOptions: sc.dateOptions ?? null,
    selectedDateIndex: sc.selectedDateIndex ?? null,
    confirmedDate: sc.surgeryDate ?? null,
    hospitalId: sc.hospitalId ?? null,
    healthPlanId: sc.healthPlanId ?? null,
    healthPlanRegistration: sc.healthPlanRegistration ?? null,
    healthPlanType: sc.healthPlanType ?? null,
    patient: mapDetailPatient(sc.patient),
    hospital: mapEntityRef(sc.hospital),
    healthPlan: mapEntityRef(sc.healthPlan),
    procedure: mapEntityRef(sc.procedure),
    tussItems: mapDetailTussItems(sc.tussItems),
    opmeItems: mapDetailOpmeItems(sc.opmeItems),
    documents: mapDetailDocuments(sc.documents),
    billing: mapDetailBilling(sc.billing),
    analysis: sc.analysis ?? null,
    contestations: sc.contestations ?? [],
    doctor,
    receipt,
  };
}
