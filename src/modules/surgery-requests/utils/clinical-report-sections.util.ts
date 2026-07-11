import type { DataSource } from 'typeorm';
import type { Repository } from 'typeorm';
import { ReportSection } from 'src/database/entities/report-section.entity';

export interface ClinicalSeedContent {
  diagnosis?: string | null;
  medicalReport?: string | null;
  patientHistory?: string | null;
  surgeryDescription?: string | null;
}

function buildParagraph(text: string): string {
  return `<p>${text.replace(/\n/g, '<br/>')}</p>`;
}

function joinParagraphs(parts: Array<string | null | undefined>): string | null {
  const filtered = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  if (!filtered.length) return null;
  return filtered.map(buildParagraph).join('');
}

/**
 * Persiste conteúdo clínico legado como seções de laudo (idempotente por título).
 */
export async function seedClinicalReportSections(
  dataSource: DataSource,
  surgeryRequestId: string,
  clinical: ClinicalSeedContent,
): Promise<void> {
  const repo = dataSource.getRepository(ReportSection);
  const existing = await repo.find({
    where: { surgeryRequestId },
    order: { order: 'ASC' },
  });
  if (existing.length > 0) return;

  const sections: Array<{ title: string; description: string | null }> = [];

  const history = joinParagraphs([
    clinical.diagnosis,
    clinical.patientHistory,
  ]);
  if (history) {
    sections.push({ title: 'Histórico e Diagnóstico', description: history });
  }

  const conduct = joinParagraphs([
    clinical.medicalReport,
    clinical.surgeryDescription,
  ]);
  if (conduct) {
    sections.push({ title: 'Conduta', description: conduct });
  }

  if (!sections.length) return;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (!section.description) continue;
    await repo.save(
      repo.create({
        surgeryRequestId,
        title: section.title,
        description: section.description,
        order: i,
      }),
    );
  }
}

export async function upsertClinicalReportSection(
  repo: Repository<ReportSection>,
  surgeryRequestId: string,
  title: string,
  description: string,
): Promise<void> {
  const trimmed = description.trim();
  if (!trimmed) return;

  const sections = await repo.find({
    where: { surgeryRequestId },
    order: { order: 'ASC' },
  });

  const existing = sections.find(
    (section) => section.title.trim().toLowerCase() === title.toLowerCase(),
  );

  if (existing) {
    existing.description = buildParagraph(trimmed);
    await repo.save(existing);
    return;
  }

  await repo.save(
    repo.create({
      surgeryRequestId,
      title,
      description: buildParagraph(trimmed),
      order: sections.length,
    }),
  );
}
