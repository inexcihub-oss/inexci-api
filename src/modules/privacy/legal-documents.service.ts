import { Injectable, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import {
  CONSENT_DOCUMENT_FILE,
  ConsentType,
} from '../../config/consent.config';

const SLUG_TO_TYPE: Record<string, ConsentType> = Object.fromEntries(
  Object.entries(CONSENT_DOCUMENT_FILE).map(([type, slug]) => [
    slug,
    type as ConsentType,
  ]),
);

const LEGAL_DIR_CANDIDATES = [
  join(__dirname, '..', '..', 'shared', 'legal'),
  join(__dirname, '..', '..', '..', 'shared', 'legal'),
  join(process.cwd(), 'src', 'shared', 'legal'),
  join(process.cwd(), 'dist', 'shared', 'legal'),
];

@Injectable()
export class LegalDocumentsService {
  async getCurrent(slug: string): Promise<{
    slug: string;
    type: ConsentType;
    content_md: string;
  }> {
    const type = SLUG_TO_TYPE[slug];
    if (!type) {
      throw new NotFoundException(`Documento "${slug}" não encontrado.`);
    }

    const filename = `${slug}.md`;

    for (const dir of LEGAL_DIR_CANDIDATES) {
      try {
        const content_md = await fs.readFile(join(dir, filename), 'utf-8');
        return { slug, type, content_md };
      } catch {}
    }

    throw new NotFoundException(
      `Arquivo "${filename}" não encontrado em src/shared/legal/.`,
    );
  }
}
