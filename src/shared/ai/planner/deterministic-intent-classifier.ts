import { Injectable } from '@nestjs/common';
import { OperationalState } from '../state/operational-state.types';
import { PlanResult, PlannerEntities, PlannerIntent } from './planner.types';

interface IntentRule {
  intent: PlannerIntent;
  /**
   * Conjuntos de palavras-chave (lowercase). Match de QUALQUER palavra
   * de QUALQUER conjunto soma 1 ponto. Quanto mais hits, maior confiança.
   * Mantido como heurística leve — qualquer caso ambíguo cai para o LLM.
   */
  keywords: string[][];
}

const INTENT_RULES: IntentRule[] = [
  {
    intent: 'create_sc',
    keywords: [
      ['criar sc', 'criar solicitacao', 'criar solicitação', 'nova sc', 'nova solicitacao', 'nova solicitação'],
      ['criar uma sc', 'criar uma solicitacao', 'criar uma solicitação'],
      ['abrir sc', 'abrir solicitacao', 'abrir uma sc'],
    ],
  },
  {
    intent: 'send_sc',
    keywords: [
      ['enviar sc', 'enviar solicitacao', 'enviar solicitação', 'mandar para analise', 'mandar para análise'],
      ['enviar para o convenio', 'enviar para o convênio'],
    ],
  },
  {
    intent: 'start_analysis',
    keywords: [['iniciar analise', 'iniciar análise', 'começar análise', 'comecar analise']],
  },
  {
    intent: 'accept_authorization',
    keywords: [['aceitar autorizacao', 'aceitar autorização', 'autorizacao aprovada', 'autorização aprovada']],
  },
  {
    intent: 'mark_performed',
    keywords: [
      ['marcar realizada', 'marcar como realizada', 'cirurgia realizada'],
      ['ja foi realizada', 'já foi realizada'],
    ],
  },
  {
    intent: 'scheduling',
    keywords: [['agendar', 'agendamento', 'remarcar', 'reagendar']],
  },
  {
    intent: 'invoice',
    keywords: [['faturar', 'faturamento', 'criar fatura', 'enviar fatura']],
  },
  {
    intent: 'contestation',
    keywords: [['contestar', 'contestacao', 'contestação', 'glosa']],
  },
  {
    intent: 'create_patient',
    keywords: [['criar paciente', 'cadastrar paciente', 'novo paciente']],
  },
  {
    intent: 'create_hospital',
    keywords: [['cadastrar hospital', 'novo hospital']],
  },
  {
    intent: 'create_health_plan',
    keywords: [['cadastrar convenio', 'cadastrar convênio', 'novo convenio', 'novo convênio']],
  },
  {
    intent: 'create_procedure',
    keywords: [['cadastrar procedimento', 'novo procedimento']],
  },
  {
    intent: 'query_sc',
    keywords: [
      ['minhas sc', 'minhas solicitacoes', 'minhas solicitações', 'lista de sc', 'listar sc'],
      ['detalhes da sc', 'status da sc', 'situacao da sc', 'situação da sc'],
    ],
  },
  {
    intent: 'query_patient',
    keywords: [['meus pacientes', 'lista de pacientes', 'buscar paciente']],
  },
  {
    intent: 'query_workflow',
    keywords: [['como funciona', 'requisitos', 'o que preciso', 'pendencias', 'pendências']],
  },
  {
    intent: 'attach_document',
    keywords: [['anexar documento', 'anexar arquivo', 'anexar laudo', 'enviar laudo']],
  },
  {
    intent: 'upload_signature',
    keywords: [['atualizar assinatura', 'enviar assinatura', 'cadastrar assinatura']],
  },
  {
    intent: 'cancel',
    keywords: [['cancelar', 'desistir', 'parar', 'esquece']],
  },
  {
    intent: 'help',
    keywords: [['ajuda', 'help', 'comandos', 'o que voce faz', 'o que você faz']],
  },
];

const SMALLTALK_TOKENS = new Set([
  'oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite',
  'tchau', 'obrigado', 'obrigada', 'valeu', 'ok', 'beleza',
]);

const CONFIRM_TOKENS = new Set([
  'sim', 'confirmo', 'confirmar', 'confirmado', 'pode',
  'pode sim', 'ok', 'okay', 'fechou', 'beleza', 'positivo',
]);

const CANCEL_TOKENS = new Set([
  'nao', 'não', 'cancela', 'cancelar', 'desfazer', 'esquece', 'negativo',
]);

const NUMERIC_RE = /^[1-9]$/;

const TUSS_RE = /\b\d{8}\b/g;
const CID_RE = /\b[A-Z]\d{2}(?:\.\d)?\b/g;
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const BR_DATE_RE = /\b(\d{2})\/(\d{2})\/(\d{2,4})\b/;

/**
 * Classificador de intent determinístico (Fase 3 do Blueprint v3).
 *
 * Estratégia: regex + keywords + sinais do estado operacional. Cobre
 * ~70-80% dos turnos típicos sem chamar LLM. Casos ambíguos retornam
 * `confidence < 0.85` e o gate roteia para o `PlannerLlm`.
 */
@Injectable()
export class DeterministicIntentClassifier {
  classify(input: {
    text: string;
    state: OperationalState;
  }): PlanResult {
    const raw = (input.text ?? '').trim();
    const normalized = raw.toLowerCase();
    const entities = this.extractEntities(raw);

    if (raw.length === 0) {
      return this.buildResult({
        intent: 'unknown',
        confidence: 0,
        state: input.state,
        entities,
        nextToolCandidates: [],
        risk: 'low',
        needsClarification: true,
        fallback: 'ask_user',
      });
    }

    if (NUMERIC_RE.test(normalized) && input.state.numericChoice) {
      return this.buildResult({
        intent: 'numeric_choice',
        confidence: 0.99,
        state: input.state,
        entities,
        nextToolCandidates: [],
        risk: 'low',
        needsClarification: false,
        fallback: 'noop',
      });
    }

    if (CONFIRM_TOKENS.has(normalized) && input.state.pendingConfirmation) {
      return this.buildResult({
        intent: 'confirm',
        confidence: 0.99,
        state: input.state,
        entities,
        nextToolCandidates: [input.state.pendingConfirmation.tool],
        risk: 'low',
        needsClarification: false,
        fallback: 'noop',
      });
    }

    if (CANCEL_TOKENS.has(normalized)) {
      const inDraft = !!input.state.activeWorkflow;
      return this.buildResult({
        intent: 'cancel',
        confidence: 0.95,
        state: input.state,
        entities,
        nextToolCandidates: inDraft ? ['draft_cancel'] : [],
        risk: 'low',
        needsClarification: false,
        fallback: 'noop',
      });
    }

    if (SMALLTALK_TOKENS.has(normalized)) {
      return this.buildResult({
        intent: 'smalltalk',
        confidence: 0.9,
        state: input.state,
        entities,
        nextToolCandidates: [],
        risk: 'low',
        needsClarification: false,
        fallback: 'noop',
      });
    }

    let bestIntent: PlannerIntent = 'unknown';
    let bestScore = 0;
    for (const rule of INTENT_RULES) {
      let score = 0;
      for (const set of rule.keywords) {
        if (set.some((kw) => normalized.includes(kw))) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestIntent = rule.intent;
      }
    }

    if (bestScore >= 1) {
      const confidence = Math.min(0.95, 0.6 + bestScore * 0.15);
      return this.buildResult({
        intent: bestIntent,
        confidence,
        state: input.state,
        entities,
        nextToolCandidates: this.candidatesFor(bestIntent),
        risk: this.riskFor(bestIntent),
        needsClarification: false,
        fallback: 'noop',
      });
    }

    if (input.state.activeWorkflow) {
      return this.buildResult({
        intent: this.mapDraftToIntent(input.state.activeWorkflow.name),
        confidence: 0.55,
        state: input.state,
        entities,
        nextToolCandidates: this.candidatesFor(
          this.mapDraftToIntent(input.state.activeWorkflow.name),
        ),
        risk: 'medium',
        needsClarification: false,
        fallback: 'ask_user',
      });
    }

    return this.buildResult({
      intent: 'unknown',
      confidence: 0.3,
      state: input.state,
      entities,
      nextToolCandidates: [],
      risk: 'medium',
      needsClarification: true,
      fallback: 'ask_user',
    });
  }

  private buildResult(args: {
    intent: PlannerIntent;
    confidence: number;
    state: OperationalState;
    entities: PlannerEntities;
    nextToolCandidates: string[];
    risk: 'low' | 'medium' | 'high';
    needsClarification: boolean;
    fallback: 'ask_user' | 'search_catalog' | 'use_premium_tier' | 'noop';
  }): PlanResult {
    return {
      intent: args.intent,
      confidence: args.confidence,
      active_workflow_continuation: !!args.state.activeWorkflow,
      active_workflow: args.state.activeWorkflow?.name ?? null,
      entities: args.entities,
      next_tool_candidates: args.nextToolCandidates,
      missing_fields: args.state.activeWorkflow?.fieldsPending ?? [],
      risk: args.risk,
      needs_clarification: args.needsClarification,
      fallback_strategy: args.fallback,
      source: 'deterministic',
    };
  }

  private extractEntities(raw: string): PlannerEntities {
    const out: PlannerEntities = {};
    const tussMatches = raw.match(TUSS_RE);
    if (tussMatches?.length) out.tuss_hint = Array.from(new Set(tussMatches));

    const cidMatches = raw.match(CID_RE);
    if (cidMatches?.length) out.cid_hint = Array.from(new Set(cidMatches));

    const isoDate = ISO_DATE_RE.exec(raw);
    const brDate = BR_DATE_RE.exec(raw);
    if (isoDate) {
      out.date_hint = `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;
    } else if (brDate) {
      const yyyy = brDate[3].length === 2 ? `20${brDate[3]}` : brDate[3];
      out.date_hint = `${yyyy}-${brDate[2]}-${brDate[1]}`;
    }

    const scMatch = /SC[-\s]?(\d{3,7})/i.exec(raw);
    if (scMatch) out.surgery_request_ref = `SC-${scMatch[1]}`;

    return out;
  }

  private mapDraftToIntent(
    draftName: NonNullable<OperationalState['activeWorkflow']>['name'],
  ): PlannerIntent {
    const map: Partial<Record<typeof draftName, PlannerIntent>> = {
      create_sc: 'create_sc',
      send_sc: 'send_sc',
      start_analysis: 'start_analysis',
      accept_authorization: 'accept_authorization',
      mark_performed: 'mark_performed',
      scheduling: 'scheduling',
      invoice: 'invoice',
      contestation: 'contestation',
      update_sc: 'update_sc',
      create_patient: 'create_patient',
      create_hospital: 'create_hospital',
      create_health_plan: 'create_health_plan',
      create_procedure: 'create_procedure',
    };
    return map[draftName] ?? 'unknown';
  }

  private candidatesFor(intent: PlannerIntent): string[] {
    switch (intent) {
      case 'create_sc':
      case 'create_patient':
      case 'create_hospital':
      case 'create_health_plan':
      case 'create_procedure':
      case 'send_sc':
      case 'start_analysis':
      case 'accept_authorization':
      case 'mark_performed':
      case 'scheduling':
      case 'invoice':
      case 'contestation':
      case 'update_sc':
        return ['plan_actions', 'draft_status', 'draft_update'];
      case 'query_sc':
        return ['query_surgery_requests'];
      case 'query_patient':
        return ['query_patients'];
      case 'query_workflow':
        return ['get_pendencies', 'get_workflow_requirements'];
      case 'attach_document':
        return ['attach_document_from_whatsapp', 'manage_documents'];
      case 'upload_signature':
        return ['upload_doctor_signature'];
      default:
        return [];
    }
  }

  private riskFor(intent: PlannerIntent): 'low' | 'medium' | 'high' {
    if (intent === 'send_sc' || intent === 'mark_performed' || intent === 'invoice')
      return 'high';
    if (intent.startsWith('create_') || intent.startsWith('update_'))
      return 'medium';
    return 'low';
  }
}
