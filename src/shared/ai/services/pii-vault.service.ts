import { Injectable, Logger } from '@nestjs/common';

/**
 * Categorias de PII reconhecidas pelo Vault.
 *
 * Toda PII enviada ao LLM externo deve ser substituída por um placeholder
 * `{{<category>_<n>}}` antes da chamada e detokenizada após a resposta,
 * antes de qualquer envio externo (WhatsApp, persistência de histórico bruto, etc.).
 */
export type PiiCategory =
  | 'patient_name'
  | 'doctor_name'
  | 'hospital_name'
  | 'health_plan_name'
  | 'cpf'
  | 'phone'
  | 'email'
  | 'address'
  | 'protocol'
  | 'date'
  | 'birth_date'
  | 'medical_report'
  | 'patient_history'
  | 'diagnosis'
  | 'surgery_description'
  | 'payload_blob';

export const ALL_PII_CATEGORIES: PiiCategory[] = [
  'patient_name',
  'doctor_name',
  'hospital_name',
  'health_plan_name',
  'cpf',
  'phone',
  'email',
  'address',
  'protocol',
  'date',
  'birth_date',
  'medical_report',
  'patient_history',
  'diagnosis',
  'surgery_description',
  'payload_blob',
];

export interface PiiBinding {
  token: string;
  category: PiiCategory;
  realValue: string;
}

/**
 * Forma serializável usada para persistir os bindings da sessão entre
 * turnos da mesma conversa (Redis/banco). Mantemos `PiiBinding[]` direto:
 * é JSON-friendly e idempotente com `restoreSession`.
 */
export type SerializedPiiBindings = PiiBinding[];

export interface ResidualPiiFinding {
  category: PiiCategory;
  sample: string;
}

@Injectable()
export class PiiVaultService {
  private readonly logger = new Logger(PiiVaultService.name);
  private readonly bindings = new Map<string, PiiBinding[]>();

  startSession(sessionId: string): void {
    if (!sessionId) return;
    if (!this.bindings.has(sessionId)) {
      this.bindings.set(sessionId, []);
    }
  }

  endSession(sessionId: string): void {
    if (!sessionId) return;
    this.bindings.delete(sessionId);
  }

  hasSession(sessionId: string): boolean {
    return this.bindings.has(sessionId);
  }

  /**
   * Restaura bindings previamente serializados (Redis/banco) na sessão atual.
   *
   * Necessário para preservar a correspondência placeholder→valor real entre
   * turnos consecutivos da mesma conversa: sem isso, os placeholders salvos
   * no histórico (`{{protocol_1}}`, `{{patient_name_1}}`, …) viram órfãos no
   * próximo turno e o `detokenize` retorna o texto inalterado.
   *
   * - Sessão é (re)criada se não existir.
   * - Mantém bindings já presentes na sessão (caso `tokenize` tenha sido
   *   chamado antes de `restoreSession` por algum motivo) e mescla pelos
   *   `(category, realValue)` para evitar duplicatas.
   */
  restoreSession(
    sessionId: string,
    bindings: SerializedPiiBindings | null | undefined,
  ): void {
    if (!sessionId) return;
    const list = this.bindings.get(sessionId) ?? [];
    if (!bindings?.length) {
      this.bindings.set(sessionId, list);
      return;
    }
    for (const incoming of bindings) {
      if (
        !incoming ||
        typeof incoming.token !== 'string' ||
        typeof incoming.realValue !== 'string'
      ) {
        continue;
      }
      const exists = list.some(
        (b) =>
          b.category === incoming.category && b.realValue === incoming.realValue,
      );
      if (exists) continue;
      list.push({
        token: incoming.token,
        category: incoming.category,
        realValue: incoming.realValue,
      });
    }
    this.bindings.set(sessionId, list);
  }

  /**
   * Snapshot serializável da sessão para persistência externa.
   * Diferente de `snapshot`, devolve apenas os campos JSON-safe.
   */
  serializeSession(sessionId: string): SerializedPiiBindings {
    return [...(this.bindings.get(sessionId) ?? [])].map((b) => ({
      token: b.token,
      category: b.category,
      realValue: b.realValue,
    }));
  }

  /**
   * Substitui um valor real por um placeholder estável dentro da sessão.
   * Reuso garantido: o mesmo valor + categoria devolvem o mesmo placeholder.
   * Valores vazios ou nulos são devolvidos como string vazia (sem registro).
   */
  tokenize(
    sessionId: string,
    value: string | number | null | undefined,
    category: PiiCategory,
  ): string {
    if (value === null || value === undefined) return '';
    const stringValue = String(value).trim();
    if (!stringValue) return '';
    if (!sessionId) return stringValue;

    const list = this.bindings.get(sessionId) ?? [];
    const existing = list.find(
      (b) => b.category === category && b.realValue === stringValue,
    );
    if (existing) return existing.token;

    const indexForCategory =
      list.filter((b) => b.category === category).length + 1;
    const token = `{{${category}_${indexForCategory}}}`;
    list.push({ token, category, realValue: stringValue });
    this.bindings.set(sessionId, list);
    return token;
  }

  /**
   * Substitui placeholders pelos valores reais. Operação inversa de tokenize.
   * Idempotente: aplicar duas vezes não corrompe o texto.
   */
  detokenize(sessionId: string, text: string): string {
    if (!text || !sessionId) return text || '';
    const list = this.bindings.get(sessionId);
    if (!list?.length) return text;

    let output = text;
    for (const binding of list) {
      if (output.includes(binding.token)) {
        output = output.split(binding.token).join(binding.realValue);
      }
    }
    return output;
  }

  /**
   * Detecta resíduos de PII estruturada (CPF, telefone BR, email) que não
   * passaram pela tokenização. Usado como filtro defensivo antes de
   * qualquer chamada ao LLM externo.
   */
  detectResidualPii(text: string): ResidualPiiFinding[] {
    const findings: ResidualPiiFinding[] = [];
    if (!text) return findings;

    const cpf = text.match(/\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{11})\b/);
    if (cpf) findings.push({ category: 'cpf', sample: cpf[0] });

    const phone = text.match(/(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}-?\d{4}/);
    if (phone) findings.push({ category: 'phone', sample: phone[0] });

    const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (email) findings.push({ category: 'email', sample: email[0] });

    return findings;
  }

  /**
   * Hash determinístico do valor para fins de auditoria sem armazenar o valor real.
   */
  hashValue(value: string): string {
    if (!value) return '';
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  /**
   * Snapshot read-only das vinculações ativas (somente para diagnóstico/teste).
   */
  snapshot(sessionId: string): PiiBinding[] {
    return [...(this.bindings.get(sessionId) ?? [])];
  }

  /**
   * Conta tokens ativos por categoria; usado para métrica/observabilidade (T0.11).
   */
  categoryCounts(sessionId: string): Record<PiiCategory, number> {
    const counts: Record<string, number> = {};
    for (const cat of ALL_PII_CATEGORIES) counts[cat] = 0;
    for (const binding of this.bindings.get(sessionId) ?? []) {
      counts[binding.category] = (counts[binding.category] ?? 0) + 1;
    }
    return counts as Record<PiiCategory, number>;
  }
}
