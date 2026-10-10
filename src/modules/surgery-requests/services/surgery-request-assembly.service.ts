import { Injectable, Logger } from '@nestjs/common';
import { SurgeryRequestReportService } from './surgery-request-report.service';
import { SurgeryRequestMutationService } from './surgery-request-mutation.service';
import { OpmeService } from '../opme/opme.service';
import { TussService } from '../../tuss/tuss.service';
import { errorMessage } from 'src/shared/utils/error-message.util';

export interface AssemblyTussItem {
  code: string;
  description?: string;
  quantity?: number;
}

export interface AssemblyReportSection {
  title: string;
  description?: string;
}

export interface AssemblyOpmeItem {
  description: string;
  qty?: number;
  supplier?: string;
  manufacturer?: string;
  suppliers?: string[];
  manufacturers?: string[];
}

export interface AssembleFromExtractedInput {
  scId: string;
  notes?: string;
  sections?: AssemblyReportSection[];
  suggestedSuppliers?: string[];
  tussItems?: AssemblyTussItem[];
  opmeItems?: AssemblyOpmeItem[];
  userId: string;
}

export interface AssembleFromExtractedOutput {
  warnings: string[];
}

const MIN_OPME_OPTIONS = 3;
const FALLBACK_OPME_NAME = 'Outros';
const EXCLUDED_REPORT_SECTION_TITLE_PATTERNS: RegExp[] = [
  /\bidentifica(?:cao|ção)\b.*\bobjetivo\b/i,
  /\bidentifica(?:cao|ção)\b.*\brelat(?:orio|ório)\b/i,
  /\bdados\b.*\bpaciente\b/i,
  /\bdados\b.*\bcadastrais\b/i,
  /\bc(?:ó|o)digos?\b.*\bsolicitados?\b/i,
  /\btuss\b/i,
  /\bcbhpm\b/i,
  /\bopme\b/i,
  /\bmateriais?\b.*\bsolicitados?\b/i,
  /\bfornecedores?\b/i,
];

function dedupeNames(names: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function padNames(names: string[], min: number, fallback: string): string[] {
  const out = [...names];
  while (out.length < min) out.push(fallback);
  return out;
}

function shouldPersistReportSection(title: string): boolean {
  const normalized = title.trim();
  if (!normalized) return false;
  return !EXCLUDED_REPORT_SECTION_TITLE_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
}

@Injectable()
export class SurgeryRequestAssemblyService {
  private readonly logger = new Logger(SurgeryRequestAssemblyService.name);

  constructor(
    private readonly reportService: SurgeryRequestReportService,
    private readonly mutationService: SurgeryRequestMutationService,
    private readonly opmeService: OpmeService,
    private readonly tussService: TussService,
  ) {}

  async assembleFromExtracted(
    input: AssembleFromExtractedInput,
  ): Promise<AssembleFromExtractedOutput> {
    const {
      scId,
      notes,
      sections,
      suggestedSuppliers,
      tussItems,
      opmeItems,
      userId,
    } = input;
    const warnings: string[] = [];

    if (sections?.length) {
      for (const section of sections) {
        if (!section?.title || !shouldPersistReportSection(section.title)) {
          continue;
        }
        try {
          await this.reportService.createReportSection(
            scId,
            { title: section.title, description: section.description ?? '' },
            userId,
          );
        } catch (err) {
          warnings.push(
            `seção "${section.title}" (${errorMessage(err) || 'erro'})`,
          );
          this.logger.warn(
            `[SC_ASSEMBLY] scId=${scId} section "${section.title}" failed: ${errorMessage(err)}`,
          );
        }
      }
    } else if (notes && typeof notes === 'string') {
      try {
        await this.reportService.createReportSection(
          scId,
          { title: 'Laudo', description: notes },
          userId,
        );
      } catch (err) {
        warnings.push(`laudo (${errorMessage(err) || 'erro'})`);
        this.logger.warn(
          `[SC_ASSEMBLY] scId=${scId} laudo failed: ${errorMessage(err)}`,
        );
      }
    }

    for (const item of tussItems ?? []) {
      const code = item?.code;
      if (!code) continue;
      let name = item.description;
      if (!name) {
        try {
          const matches = this.tussService.lookup(code, 1);
          if (matches?.[0]?.name) name = matches[0].name;
        } catch (err) {
          this.logger.warn(
            `[SC_ASSEMBLY] scId=${scId} lookup TUSS ${code} falhou: ${(err as Error)?.message}`,
          );
        }
      }
      if (!name) {
        warnings.push(`TUSS ${code} (descrição não resolvida)`);
        continue;
      }
      try {
        await this.mutationService.addTussItem(
          scId,
          {
            tussCode: code,
            name,
            quantity: typeof item.quantity === 'number' ? item.quantity : 1,
          },
          userId,
        );
      } catch (err) {
        warnings.push(`TUSS ${code} (${errorMessage(err) || 'erro'})`);
      }
    }

    let opmeAdded = 0;
    for (const item of opmeItems ?? []) {
      const name = item?.description;
      if (!name) continue;
      const supplierNames = padNames(
        dedupeNames([
          item.supplier,
          ...(item.suppliers ?? []),
          ...(suggestedSuppliers ?? []),
        ]),
        MIN_OPME_OPTIONS,
        FALLBACK_OPME_NAME,
      );
      const manufacturerNames = padNames(
        dedupeNames([item.manufacturer, ...(item.manufacturers ?? [])]),
        MIN_OPME_OPTIONS,
        FALLBACK_OPME_NAME,
      );

      try {
        await this.opmeService.create(
          {
            surgeryRequestId: scId,
            name,
            manufacturerNames,
            quantity: typeof item.qty === 'number' ? item.qty : 1,
            supplierNames,
          },
          userId,
        );
        opmeAdded += 1;
      } catch (err) {
        warnings.push(`OPME ${name} (${errorMessage(err) || 'erro'})`);
      }
    }

    if (opmeAdded > 0) {
      try {
        await this.mutationService.setHasOpme(scId, true, userId);
      } catch (err) {
        this.logger.warn(
          `[SC_ASSEMBLY] scId=${scId} setHasOpme falhou: ${(err as Error)?.message}`,
        );
      }
    }

    return { warnings };
  }
}
