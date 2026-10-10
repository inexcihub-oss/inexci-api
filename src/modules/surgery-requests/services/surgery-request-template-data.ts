import { SurgeryRequestPriority } from 'src/database/entities/surgery-request.entity';
import {
  SurgeryRequestTemplateData,
  TemplateEntityRef,
  TemplateOpmeItem,
  TemplateRequiredDocument,
  TemplateTussItem,
} from 'src/database/entities/surgery-request-template.entity';
import DOCUMENT_TYPES from 'src/common/document-types.common';

const TIPOS_DE_DOCUMENTO_INTERNOS = new Set<string>([
  DOCUMENT_TYPES.scCreationSource,
]);

const PRIORIDADES_VALIDAS = new Set<number>(
  Object.values(SurgeryRequestPriority).filter(
    (v): v is number => typeof v === 'number',
  ),
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const texto = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const arrayDe = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

function refDeEntidade(value: unknown): TemplateEntityRef | undefined {
  if (!isRecord(value)) return undefined;
  const id = texto(value.id);
  const name = texto(value.name);
  return id && name ? { id, name } : undefined;
}

function nomesDeLista(value: unknown): string[] {
  return arrayDe(value)
    .map((item) => (isRecord(item) ? texto(item.name) : texto(item)))
    .filter(Boolean);
}

function itensTuss(value: unknown): TemplateTussItem[] {
  return arrayDe(value)
    .filter(isRecord)
    .map((item) => ({
      tussCode: texto(item.tussCode),
      name: texto(item.name),
      quantity: Number(item.quantity) || 1,
    }))
    .filter((item) => item.tussCode.length > 0);
}

function itensOpme(value: unknown): TemplateOpmeItem[] {
  return arrayDe(value)
    .filter(isRecord)
    .map((item) => ({
      name: texto(item.name),
      quantity: Number(item.quantity) || 1,
      manufacturers: nomesDeLista(item.manufacturers),
      suppliers: nomesDeLista(
        Array.isArray(item.suppliers)
          ? item.suppliers
          : [item.distributor ?? item.supplier].filter(Boolean),
      ),
    }))
    .filter((item) => item.name.length > 0);
}

function documentosExigidos(value: unknown): TemplateRequiredDocument[] {
  return arrayDe(value)
    .filter(isRecord)
    .map((item) => ({
      type: texto(item.type),
      name: texto(item.name) || texto(item.type),
    }))
    .filter(
      (item) =>
        item.type.length > 0 && !TIPOS_DE_DOCUMENTO_INTERNOS.has(item.type),
    );
}

export function sanitizeTemplateData(
  input: unknown,
): SurgeryRequestTemplateData {
  if (!isRecord(input)) return {};

  const data: SurgeryRequestTemplateData = {};

  const procedure = refDeEntidade(input.procedure);
  if (procedure) data.procedure = procedure;

  const procedureName = texto(input.procedureName);
  if (procedureName) data.procedureName = procedureName;

  const hospital = refDeEntidade(input.hospital);
  if (hospital) data.hospital = hospital;

  const healthPlan = refDeEntidade(input.healthPlan);
  if (healthPlan) data.healthPlan = healthPlan;

  const priority = Number(input.priority);
  if (PRIORIDADES_VALIDAS.has(priority)) {
    data.priority = priority;
  }

  const tussItems = itensTuss(input.tussItems ?? input.procedures);
  if (tussItems.length > 0) data.tussItems = tussItems;

  const opmeItems = itensOpme(input.opmeItems);
  if (opmeItems.length > 0) data.opmeItems = opmeItems;

  const requiredDocuments = documentosExigidos(input.requiredDocuments);
  if (requiredDocuments.length > 0) data.requiredDocuments = requiredDocuments;

  return data;
}
