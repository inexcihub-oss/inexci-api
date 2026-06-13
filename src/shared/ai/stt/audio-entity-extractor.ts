import { Injectable } from '@nestjs/common';
import { AudioExtractionEntities } from './stt.types';

const TUSS_RE = /\b\d{8}\b/g;
const CID_RE = /\b[A-Z]\d{2}(?:\.\d)?\b/g;
const SC_RE = /\bSC[-\s]?(\d{3,7})\b/i;
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const BR_DATE_RE = /\b(\d{2})\/(\d{2})\/(\d{2,4})\b/;
const CRM_RE = /\bCRM[-\s]?[A-Z]{2}\s*\d{4,7}\b/i;
const BRL_MONEY_RE = /\bR\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\b/g;

const HOSPITAL_HINTS = [
  'hospital',
  'clínica',
  'clinica',
  'instituto',
  'casa de saúde',
];
const HEALTH_PLAN_HINTS = ['unimed', 'amil', 'bradesco', 'sulamerica', 'hapvida'];

/**
 * Extrator determinístico de entidades de áudio (Fase 4 do Blueprint v3).
 * 100% regex/keywords — zero LLM. O `confidence` reflete a força do match.
 */
@Injectable()
export class AudioEntityExtractor {
  extract(text: string): {
    entities: AudioExtractionEntities;
    confidence: { [k in keyof AudioExtractionEntities]?: number };
    intent_hint: string | null;
  } {
    const entities: AudioExtractionEntities = {};
    const confidence: { [k in keyof AudioExtractionEntities]?: number } = {};

    const tussMatches = text.match(TUSS_RE);
    if (tussMatches?.length) {
      entities.tuss_hint = Array.from(new Set(tussMatches));
      confidence.tuss_hint = 0.9;
    }

    const cidMatches = text.match(CID_RE);
    if (cidMatches?.length) {
      entities.cid_hint = Array.from(new Set(cidMatches));
      confidence.cid_hint = 0.85;
    }

    const isoDate = ISO_DATE_RE.exec(text);
    const brDate = BR_DATE_RE.exec(text);
    if (isoDate) {
      entities.date_hint = `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;
      confidence.date_hint = 0.95;
    } else if (brDate) {
      const yyyy = brDate[3].length === 2 ? `20${brDate[3]}` : brDate[3];
      entities.date_hint = `${yyyy}-${brDate[2]}-${brDate[1]}`;
      confidence.date_hint = 0.85;
    }

    const sc = SC_RE.exec(text);
    if (sc) {
      entities.surgery_request_ref = `SC-${sc[1]}`;
      confidence.surgery_request_ref = 0.95;
    }

    const crm = CRM_RE.exec(text);
    if (crm) {
      entities.doctor_crm = crm[0].toUpperCase();
      confidence.doctor_crm = 0.85;
    }

    const monetary: number[] = [];
    let moneyMatch: RegExpExecArray | null;
    while ((moneyMatch = BRL_MONEY_RE.exec(text)) !== null) {
      const cents = moneyMatch[1].replace(/\./g, '').replace(',', '.');
      const value = Number(cents);
      if (Number.isFinite(value)) monetary.push(value);
    }
    if (monetary.length) {
      entities.monetary_values = monetary;
      confidence.monetary_values = 0.9;
    }

    const lower = text.toLowerCase();
    for (const hint of HOSPITAL_HINTS) {
      const idx = lower.indexOf(hint);
      if (idx >= 0) {
        const tail = text.slice(idx + hint.length, idx + hint.length + 60);
        const m = /^[\s:]+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÁ-Úá-ú\s]{2,40})/.exec(tail);
        if (m) {
          entities.hospital_alias = m[1].trim();
          confidence.hospital_alias = 0.65;
          break;
        }
      }
    }
    for (const hint of HEALTH_PLAN_HINTS) {
      if (lower.includes(hint)) {
        entities.health_plan_alias = hint.charAt(0).toUpperCase() + hint.slice(1);
        confidence.health_plan_alias = 0.75;
        break;
      }
    }

    const intent = this.guessIntent(lower, entities);

    return { entities, confidence, intent_hint: intent };
  }

  private guessIntent(
    lowerText: string,
    entities: AudioExtractionEntities,
  ): string | null {
    if (entities.surgery_request_ref) {
      if (/(faturar|fatura|cobran)/.test(lowerText)) return 'invoice';
      if (/(enviar|encaminhar|mandar)/.test(lowerText)) return 'send_sc';
      if (/(agendar|agendamento|remarcar)/.test(lowerText)) return 'scheduling';
      if (/(realizada|realizou|cirurgia foi)/.test(lowerText)) return 'mark_performed';
      return 'query_sc';
    }
    if (/(criar|abrir|nova)\s+(sc|solicita)/.test(lowerText)) return 'create_sc';
    if (/(cadastrar|cadastro)\s+(de\s+)?paciente/.test(lowerText)) return 'create_patient';
    if (/(cadastrar|cadastro)\s+(de\s+)?hospital/.test(lowerText)) return 'create_hospital';
    if (/(cadastrar|cadastro)\s+(de\s+)?conv/.test(lowerText)) return 'create_health_plan';
    if (entities.tuss_hint?.length || entities.cid_hint?.length) return 'create_sc';
    return null;
  }
}
