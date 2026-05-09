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

// Em dev (ts-node) `__dirname` aponta para `src/modules/privacy/`, e os
// `.md` ficam em `src/shared/legal/`. Após o build, o Nest CLI copia os
// assets para `dist/shared/legal/`, mas o JS compilado fica em
// `dist/src/modules/privacy/` (porque o tsc adota `rootDir: "."` ao
// detectar a pasta `scripts/` ao lado de `src/`). Isso gera um nível
// extra de `src/`, então procuramos em ambos os layouts.
const LEGAL_DIR_CANDIDATES = [
  join(__dirname, '..', '..', 'shared', 'legal'),
  join(__dirname, '..', '..', '..', 'shared', 'legal'),
  join(process.cwd(), 'src', 'shared', 'legal'),
  join(process.cwd(), 'dist', 'shared', 'legal'),
];

@Injectable()
export class LegalDocumentsService {
  /**
   * Serve o markdown atual de um documento legal.
   * Caminho-fonte: src/shared/legal/<slug>.md
   */
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
      } catch {
        // tenta o próximo candidato
      }
    }

    throw new NotFoundException(
      `Arquivo "${filename}" não encontrado em src/shared/legal/.`,
    );
  }
}
