import { Injectable, Logger, Optional } from '@nestjs/common';
import { SurgeryRequestsService } from '../surgery-requests.service';
import { OpmeService } from '../opme/opme.service';
import { TussService } from '../../tuss/tuss.service';

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
  /** Lista de fornecedores candidatos (além de `supplier`, se ambos vierem). */
  suppliers?: string[];
  /** Lista de fabricantes candidatos (além de `manufacturer`, se ambos vierem). */
  manufacturers?: string[];
}

export interface AssembleFromExtractedInput {
  scId: string;
  notes?: string;
  /**
   * Seções estruturadas do laudo (título + descrição). Quando fornecido,
   * tem prioridade sobre `notes` — cria uma `ReportSection` por item, na
   * ordem da lista. `notes` permanece como fallback de compatibilidade
   * (cria uma única seção "Laudo") para chamadores que ainda não migraram.
   */
  sections?: AssemblyReportSection[];
  /**
   * Fornecedores sugeridos no nível do documento (ex.: empresa que fornece
   * + empresas alternativas para cotação) — aplicados a TODOS os itens OPME
   * que não tiverem fornecedor próprio suficiente.
   */
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

/**
 * Popula laudo, TUSS e OPME numa SC já criada a partir dos dados extraídos
 * de um documento (seja via WhatsApp ou via upload web). Toda falha é
 * best-effort: warnings são acumulados e retornados ao chamador, nunca
 * derrubam a operação principal.
 */
@Injectable()
export class SurgeryRequestAssemblyService {
  private readonly logger = new Logger(SurgeryRequestAssemblyService.name);

  constructor(
    private readonly surgeryRequestsService: SurgeryRequestsService,
    @Optional() private readonly opmeService?: OpmeService,
    @Optional() private readonly tussService?: TussService,
  ) {}

  async assembleFromExtracted(
    input: AssembleFromExtractedInput,
  ): Promise<AssembleFromExtractedOutput> {
    const { scId, notes, sections, suggestedSuppliers, tussItems, opmeItems, userId } =
      input;
    const warnings: string[] = [];

    if (sections?.length) {
      for (const section of sections) {
        if (!section?.title) continue;
        try {
          await this.surgeryRequestsService.createReportSection(
            scId,
            { title: section.title, description: section.description ?? '' },
            userId,
          );
        } catch (err: any) {
          warnings.push(`seção "${section.title}" (${err?.message || 'erro'})`);
          this.logger.warn(
            `[SC_ASSEMBLY] scId=${scId} section "${section.title}" failed: ${err?.message}`,
          );
        }
      }
    } else if (notes && typeof notes === 'string') {
      try {
        await this.surgeryRequestsService.createReportSection(
          scId,
          { title: 'Laudo', description: notes },
          userId,
        );
      } catch (err: any) {
        warnings.push(`laudo (${err?.message || 'erro'})`);
        this.logger.warn(`[SC_ASSEMBLY] scId=${scId} laudo failed: ${err?.message}`);
      }
    }

    for (const item of tussItems ?? []) {
      const code = item?.code;
      if (!code) continue;
      let name = item.description;
      if (!name && this.tussService) {
        try {
          const matches = this.tussService.lookup(code, 1);
          if (matches?.[0]?.name) name = matches[0].name;
        } catch {
          // catálogo indisponível — segue sem descrição
        }
      }
      if (!name) {
        warnings.push(`TUSS ${code} (descrição não resolvida)`);
        continue;
      }
      try {
        await this.surgeryRequestsService.addTussItem(
          scId,
          {
            tussCode: code,
            name,
            quantity: typeof item.quantity === 'number' ? item.quantity : 1,
          },
          userId,
        );
      } catch (err: any) {
        warnings.push(`TUSS ${code} (${err?.message || 'erro'})`);
      }
    }

    let opmeAdded = 0;
    for (const item of opmeItems ?? []) {
      const name = item?.description;
      if (!name) continue;
      // Plataforma exige >=3 fornecedores e >=3 fabricantes; mesclamos o
      // que o documento trouxe (item + sugestões gerais) e preenchemos o
      // restante com "Outros" (fornecedor/fabricante fallback reaproveitável).
      const supplierNames = padNames(
        dedupeNames([item.supplier, ...(item.suppliers ?? []), ...(suggestedSuppliers ?? [])]),
        MIN_OPME_OPTIONS,
        FALLBACK_OPME_NAME,
      );
      const manufacturerNames = padNames(
        dedupeNames([item.manufacturer, ...(item.manufacturers ?? [])]),
        MIN_OPME_OPTIONS,
        FALLBACK_OPME_NAME,
      );

      if (!this.opmeService) {
        warnings.push(`OPME ${name} (serviço indisponível)`);
        continue;
      }
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
      } catch (err: any) {
        warnings.push(`OPME ${name} (${err?.message || 'erro'})`);
      }
    }

    if (opmeAdded > 0) {
      try {
        await this.surgeryRequestsService.setHasOpme(scId, true, userId);
      } catch {
        // não-crítico
      }
    }

    return { warnings };
  }
}
