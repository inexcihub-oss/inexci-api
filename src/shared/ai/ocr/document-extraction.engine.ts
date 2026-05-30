import { Injectable } from '@nestjs/common';
import {
  parseCidCodes,
  parseCnpjs,
  parseCpfs,
  parseCrms,
  parseDates,
  parseMoney,
  parsePhones,
  parseTussCodes,
} from '../parsers';
import {
  DocumentExtraction,
  DocumentRecommendation,
  FieldExtraction,
} from './document-extraction.types';

/**
 * Confidence engine (Fase 5 do Blueprint v3).
 *
 * Roda parsers determinísticos sobre o texto do documento e calcula
 * `global_confidence` + `recommendation`.
 *
 * Decisão (alinhada ao §8.3 do blueprint):
 *   - global ≥ 0.85               → `accept` (sem LLM)
 *   - 0.6 ≤ global < 0.85         → `cheap_llm` (gpt-4o-mini classifier)
 *   - global < 0.6 (texto curto)  → `vision_fallback` (apenas para imagens — caller decide)
 *   - sem campos extraídos        → `ask_user`
 */
@Injectable()
export class DocumentExtractionEngine {
  extract(input: {
    text: string;
    /** Cross-ref opcional para validar TUSS no `tuss.json`. */
    tussIsValid?: (code: string) => boolean;
    /** Cross-ref opcional para validar CID no `cid.json`. */
    cidIsValid?: (code: string) => boolean;
  }): DocumentExtraction {
    const text = input.text ?? '';
    const fields: FieldExtraction[] = [];

    for (const cpf of parseCpfs(text)) {
      fields.push({
        field: 'cpf',
        value: cpf.value,
        confidence: cpf.confidence,
        sources: cpf.sources,
        raw: cpf.raw,
      });
    }

    for (const cnpj of parseCnpjs(text)) {
      fields.push({
        field: 'cnpj',
        value: cnpj.value,
        confidence: cnpj.confidence,
        sources: cnpj.sources,
        raw: cnpj.raw,
      });
    }

    for (const crm of parseCrms(text)) {
      fields.push({
        field: 'doctor_crm',
        value: crm.value,
        confidence: crm.confidence,
        sources: crm.sources,
        raw: crm.raw,
      });
    }

    for (const tuss of parseTussCodes(text, input.tussIsValid)) {
      fields.push({
        field: 'tuss_code',
        value: tuss.value,
        confidence: tuss.confidence,
        sources: tuss.sources,
        raw: tuss.raw,
      });
    }

    for (const cid of parseCidCodes(text, input.cidIsValid)) {
      fields.push({
        field: 'cid_code',
        value: cid.value,
        confidence: cid.confidence,
        sources: cid.sources,
        raw: cid.raw,
      });
    }

    for (const date of parseDates(text)) {
      fields.push({
        field: 'date',
        value: date.value,
        confidence: date.confidence,
        sources: date.sources,
        raw: date.raw,
      });
    }

    for (const phone of parsePhones(text)) {
      fields.push({
        field: 'phone',
        value: phone.value,
        confidence: phone.confidence,
        sources: phone.sources,
        raw: phone.raw,
      });
    }

    for (const money of parseMoney(text)) {
      fields.push({
        field: 'money',
        value: money.value,
        confidence: money.confidence,
        sources: money.sources,
        raw: money.raw,
      });
    }

    const global_confidence = this.computeGlobalConfidence(fields, text);
    const weak_fields = fields
      .filter((f) => f.confidence < 0.6)
      .map((f) => f.field);
    const recommendation: DocumentRecommendation = this.recommend(
      global_confidence,
      fields.length,
      text.length,
    );

    return {
      fields,
      global_confidence,
      recommendation,
      weak_fields,
    };
  }

  private computeGlobalConfidence(
    fields: FieldExtraction[],
    text: string,
  ): number {
    if (!fields.length) return text.length > 0 ? 0.2 : 0;
    const sum = fields.reduce((acc, f) => acc + f.confidence, 0);
    const avg = sum / fields.length;
    // Penalidade leve para textos muito curtos (< 50 chars), bonus pequeno para longos.
    const lengthFactor =
      text.length < 50 ? 0.7 : text.length < 200 ? 0.9 : 1.0;
    return Math.min(1, avg * lengthFactor);
  }

  private recommend(
    confidence: number,
    fieldsCount: number,
    textLength: number,
  ): DocumentRecommendation {
    if (fieldsCount === 0 && textLength < 30) return 'vision_fallback';
    if (fieldsCount === 0) return 'ask_user';
    if (confidence >= 0.85) return 'accept';
    if (confidence >= 0.6) return 'cheap_llm';
    return 'vision_fallback';
  }
}
