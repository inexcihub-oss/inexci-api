import type { DataSource } from 'typeorm';
import type { Repository } from 'typeorm';
import * as sanitizeHtml from 'sanitize-html';
import { ReportSection } from 'src/database/entities/report-section.entity';

export interface ClinicalSeedContent {
  diagnosis?: string | null;
  medicalReport?: string | null;
  patientHistory?: string | null;
  surgeryDescription?: string | null;
}

/**
 * Sanitizacao do conteudo de secao de laudo. Este util e o caminho usado pelo
 * commit de draft da IA/WhatsApp, cujo conteudo vem de mensagens e de OCR de
 * documentos enviados por terceiros — antes gravava HTML cru, que os templates
 * renderizam com triple-stash dentro do Chromium.
 */
const OPCOES_SANITIZACAO: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'blockquote',
    'span',
  ],
  allowedAttributes: { span: ['style'], p: ['style'] },
  allowedStyles: {
    '*': {
      'text-align': [/^left$|^right$|^center$|^justify$/],
      'font-weight': [/^bold$|^normal$|^\d{3}$/],
      'text-decoration': [/^underline$|^line-through$|^none$/],
    },
  },
  disallowedTagsMode: 'discard',
};

export function sanitizarConteudoDeSecao(html: string): string {
  return sanitizeHtml(html ?? '', OPCOES_SANITIZACAO);
}

function buildParagraph(text: string): string {
  return `<p>${text.replace(/\n/g, '<br/>')}</p>`;
}

function joinParagraphs(
  parts: Array<string | null | undefined>,
): string | null {
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

  const history = joinParagraphs([clinical.diagnosis, clinical.patientHistory]);
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
    existing.description = buildParagraph(sanitizarConteudoDeSecao(trimmed));
    await repo.save(existing);
    return;
  }

  await repo.save(
    repo.create({
      surgeryRequestId,
      title: sanitizarConteudoDeSecao(title),
      description: buildParagraph(sanitizarConteudoDeSecao(trimmed)),
      order: sections.length,
    }),
  );
}
