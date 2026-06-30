import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { Patient } from 'src/database/entities/patient.entity';
import { Hospital } from 'src/database/entities/hospital.entity';
import { HealthPlan } from 'src/database/entities/health-plan.entity';
import { Procedure } from 'src/database/entities/procedure.entity';
import { DocumentClassificationExtracted } from 'src/shared/ai/ocr/document-classifier.types';

export interface EntityCandidate {
  id: string;
  name: string;
}

export interface PatientCandidate extends EntityCandidate {
  cpf?: string;
}

export interface ResolvedCandidates {
  patient: PatientCandidate[];
  hospital: EntityCandidate[];
  healthPlan: EntityCandidate[];
  procedure: EntityCandidate[];
  /** true quando o documento identificou um paciente pelo nome mas sem CPF. */
  patientCpfMissing: boolean;
  /** true quando há um único match exato de paciente por CPF. */
  patientMatchedByCpf: boolean;
}

const MAX_CANDIDATES = 5;

function normalizeCpf(raw?: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  return digits.length === 11 ? digits : null;
}

function normalizeSearchText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildSearchTerms(raw: string): string[] {
  const base = (raw || '').trim();
  if (!base) return [];

  const terms = new Set<string>();
  terms.add(base);

  // Ex.: "SULAMERICA 88888 0167 4659 0018" -> "SULAMERICA"
  const withoutLongNumbers = base
    .replace(/\b\d[\d\s./-]{7,}\d\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (withoutLongNumbers.length >= 2) terms.add(withoutLongNumbers);

  // Ex.: "Local: Será realizada no Hospital Caxias D'Or, na data..."
  // -> "Hospital Caxias D'Or"
  const venueMatch = base.match(/\b(hospital[^,.;:\n]*|cl[ií]nica[^,.;:\n]*)/i);
  if (venueMatch?.[1]) {
    const venue = venueMatch[1].replace(/\s+/g, ' ').trim();
    if (venue.length >= 2) terms.add(venue);
  }

  return Array.from(terms).slice(0, 4);
}

/**
 * A partir dos dados extraídos de um documento, busca candidatos existentes
 * no banco (escopados por ownerId) para paciente, hospital, convênio e
 * procedimento. Todas as buscas são best-effort — se não encontrar, retorna
 * lista vazia.
 */
@Injectable()
export class DocumentEntityResolverService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly accessControlService: AccessControlService,
  ) {}

  async resolveCandidates(
    extracted: DocumentClassificationExtracted,
    userId: string,
  ): Promise<ResolvedCandidates> {
    const ownerId = await this.accessControlService.getOwnerId(userId);

    const [patient, hospital, healthPlan, procedure] = await Promise.all([
      this.resolvePatient(extracted, ownerId),
      this.resolveByName<Hospital>(Hospital, extracted.hospital, ownerId),
      this.resolveByName<HealthPlan>(
        HealthPlan,
        extracted.healthPlan?.name,
        ownerId,
      ),
      this.resolveByName<Procedure>(
        Procedure,
        extracted.suggestedProcedureName,
        ownerId,
      ),
    ]);

    const patientCpfMissing =
      !!(extracted.patient?.name && !extracted.patient?.cpf) &&
      patient.candidates.length === 0;

    return {
      patient: patient.candidates,
      hospital,
      healthPlan,
      procedure,
      patientCpfMissing,
      patientMatchedByCpf: patient.matchedByCpf,
    };
  }

  private async resolvePatient(
    extracted: DocumentClassificationExtracted,
    ownerId: string,
  ): Promise<{ candidates: PatientCandidate[]; matchedByCpf: boolean }> {
    const cpf = normalizeCpf(extracted.patient?.cpf);
    const name = (extracted.patient?.name ?? '').trim();

    if (cpf) {
      const rows = await this.dataSource
        .getRepository(Patient)
        .createQueryBuilder('p')
        .where('p.owner_id = :ownerId', { ownerId })
        .andWhere('p.cpf = :cpf', { cpf })
        .select(['p.id', 'p.name', 'p.cpf'])
        .limit(1)
        .getMany();

      if (rows.length > 0) {
        return {
          candidates: rows.map((r) => ({
            id: r.id,
            name: r.name,
            cpf: r.cpf ?? undefined,
          })),
          matchedByCpf: true,
        };
      }
    }

    if (name.length >= 2) {
      const rows = await this.dataSource
        .getRepository(Patient)
        .createQueryBuilder('p')
        .where('p.owner_id = :ownerId', { ownerId })
        .andWhere('unaccent(lower(p.name)) ILIKE unaccent(lower(:term))', {
          term: `%${name}%`,
        })
        .select(['p.id', 'p.name', 'p.cpf'])
        .limit(MAX_CANDIDATES)
        .getMany();

      return {
        candidates: rows.map((r) => ({
          id: r.id,
          name: r.name,
          cpf: r.cpf ?? undefined,
        })),
        matchedByCpf: false,
      };
    }

    return { candidates: [], matchedByCpf: false };
  }

  private async resolveByName<T extends { id: string; name: string }>(
    entity: new () => T,
    name: string | undefined,
    ownerId: string,
  ): Promise<EntityCandidate[]> {
    const term = (name ?? '').trim();
    if (term.length < 2) return [];

    const terms = buildSearchTerms(term);
    if (!terms.length) return [];

    const unique = new Map<string, EntityCandidate>();

    try {
      const repo = this.dataSource.getRepository(entity);

      for (const candidateTerm of terms) {
        const termNorm = normalizeSearchText(candidateTerm);
        if (termNorm.length < 2) continue;

        const rows = await repo
          .createQueryBuilder('e')
          .where('e.owner_id = :ownerId', { ownerId })
          .andWhere(
            `(
              regexp_replace(unaccent(lower(e.name)), '[^a-z0-9]+', ' ', 'g') ILIKE :termLike
              OR :termNorm ILIKE ('%' || regexp_replace(unaccent(lower(e.name)), '[^a-z0-9]+', ' ', 'g') || '%')
            )`,
            {
              termLike: `%${termNorm}%`,
              termNorm,
            },
          )
          .select(['e.id', 'e.name'])
          .limit(MAX_CANDIDATES)
          .getMany();

        for (const r of rows) {
          if (!unique.has(r.id)) {
            unique.set(r.id, { id: r.id, name: r.name });
          }
        }

        if (unique.size >= MAX_CANDIDATES) break;
      }

      return Array.from(unique.values()).slice(0, MAX_CANDIDATES);
    } catch {
      return [];
    }
  }
}
