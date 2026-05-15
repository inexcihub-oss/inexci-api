import { Injectable } from '@nestjs/common';
import { DocumentClassification } from '../document-classifier.types';

@Injectable()
export class DocumentExtractionEngineService {
  enrich(
    text: string,
    classification: DocumentClassification | null,
  ): DocumentClassification | null {
    if (!classification) return null;
    const extracted = classification.extracted || {};

    const patient = extracted.patient || {};
    const cpf = text.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/)?.[0];
    const phone = text.match(
      /(?:\+55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}-?\d{4}/,
    )?.[0];
    const crm = text.match(/\bCRM[-\s:]?[A-Z]{0,2}\s?\d{4,8}\b/i)?.[0];
    const cidMatches = [...text.matchAll(/\b[A-Z]\d{2}(?:\.\d)?\b/g)].map(
      (match) => ({
        code: match[0],
      }),
    );
    const tussMatches = [...text.matchAll(/\b\d{8,9}\b/g)].map((match) => ({
      code: match[0],
      description: '',
    }));

    classification.extracted = {
      ...extracted,
      patient: {
        ...patient,
        ...(patient?.cpf || cpf ? { cpf: patient?.cpf || cpf } : {}),
        ...(patient?.phone || phone ? { phone: patient?.phone || phone } : {}),
      },
      ...(extracted.cid?.length
        ? { cid: extracted.cid }
        : cidMatches.length
          ? { cid: cidMatches }
          : {}),
      ...(extracted.tuss?.length
        ? { tuss: extracted.tuss }
        : tussMatches.length
          ? { tuss: tussMatches }
          : {}),
      notes:
        [extracted.notes, crm ? `crm_detectado=${crm}` : null]
          .filter(Boolean)
          .join(' | ') || extracted.notes,
    };

    return classification;
  }
}
