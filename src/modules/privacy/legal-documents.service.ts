import { Injectable, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import {
  CONSENT_DOCUMENT_FILE,
  CURRENT_CONSENT_VERSIONS,
} from '../../config/consent.config';
import { ConsentType } from '../../database/entities/consent-log.entity';

const SLUG_TO_TYPE: Record<string, ConsentType> = Object.fromEntries(
  Object.entries(CONSENT_DOCUMENT_FILE).map(([type, slug]) => [
    slug,
    type as ConsentType,
  ]),
);

@Injectable()
export class LegalDocumentsService {
  /**
   * Serve o markdown atual de um documento legal.
   * Caminho: src/shared/legal/<slug>-<version>.md
   */
  async getCurrent(slug: string): Promise<{
    slug: string;
    type: ConsentType;
    version: string;
    content_md: string;
  }> {
    const type = SLUG_TO_TYPE[slug];
    if (!type) {
      throw new NotFoundException(`Documento "${slug}" não encontrado.`);
    }

    const version = CURRENT_CONSENT_VERSIONS[type];
    const filename = `${slug}-${version}.md`;
    const fullPath = join(__dirname, '..', '..', 'shared', 'legal', filename);

    try {
      const content_md = await fs.readFile(fullPath, 'utf-8');
      return { slug, type, version, content_md };
    } catch {
      throw new NotFoundException(
        `Arquivo "${filename}" não encontrado em src/shared/legal/.`,
      );
    }
  }
}
