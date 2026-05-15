import { SttGlossary } from './stt.types';

/**
 * Glossário base do pós-processamento STT (Fase 4 do Blueprint v3).
 *
 * Mantido como constante TS (em vez de JSON) para tipagem e para que
 * mudanças entrem no review junto ao código que consome. Adicione
 * entradas conforme observações reais — pequenas correções têm impacto
 * grande na qualidade do classifier downstream.
 */
export const STT_GLOSSARY: SttGlossary = {
  tld_phrases: {
    'ponto com br': '.com.br',
    'ponto com': '.com',
    'ponto br': '.br',
    'ponto net': '.net',
    'ponto org': '.org',
    'ponto io': '.io',
  },
  medical_corrections: {
    'tu ess': 'TUSS',
    'tuss s': 'TUSS',
    'see ide': 'CID',
    'see-ide': 'CID',
    'see id': 'CID',
    'guia s p sadt': 'guia SP/SADT',
    'guia sp s a d t': 'guia SP/SADT',
    'cee r m': 'CRM',
    'cre m': 'CRM',
    'se ar em': 'CRM',
    'opi e mi': 'OPME',
    'oh pe me': 'OPME',
    'fatura s u s': 'fatura SUS',
  },
  hospital_aliases: [
    {
      spoken: ['são lucas', 'sao lucas', 'sãolucas', 'saolucas'],
      canonical_hint: 'Hospital São Lucas',
    },
    {
      spoken: ['einstein', 'albert einstein'],
      canonical_hint: 'Hospital Israelita Albert Einstein',
    },
    {
      spoken: ['sirio', 'sírio', 'sirio libanes', 'sírio-libanês'],
      canonical_hint: 'Hospital Sírio-Libanês',
    },
  ],
};

/**
 * Aplica o glossário em uma string. Mantém imutabilidade do input,
 * devolve nova string. Idempotente.
 */
export function applyGlossary(input: string, glossary: SttGlossary = STT_GLOSSARY): string {
  if (!input) return input;
  let out = ` ${input.toLowerCase()} `;

  for (const [phrase, replacement] of Object.entries(glossary.tld_phrases)) {
    const re = new RegExp(`\\s${escapeRegex(phrase)}\\s`, 'g');
    out = out.replace(re, ` ${replacement} `);
  }
  for (const [phrase, replacement] of Object.entries(
    glossary.medical_corrections,
  )) {
    const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'g');
    out = out.replace(re, replacement);
  }
  for (const alias of glossary.hospital_aliases) {
    for (const spoken of alias.spoken) {
      const re = new RegExp(`\\b${escapeRegex(spoken)}\\b`, 'g');
      out = out.replace(re, alias.canonical_hint);
    }
  }
  return out.trim().replace(/\s{2,}/g, ' ');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
