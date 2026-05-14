import { Injectable, Logger } from '@nestjs/common';
import { WhatsappDocumentDispatcherService } from '../whatsapp-document-dispatcher.service';
import { WhatsappDocumentProcessorService } from '../whatsapp-document-processor.service';
import { WhatsappService } from '../../../whatsapp/whatsapp.service';
import { ConversationService } from '../conversation.service';
import { PhoneNormalizerService } from './phone-normalizer.service';

/**
 * Gerencia o pipeline de documentos inbound do WhatsApp (imagens e PDFs):
 * staging, intent gate e delegação ao processador OCR/classificador.
 *
 * Extraído de `AiOrchestratorService` na Fase 5 do
 * `PLANO-CORRECOES-CODE-REVIEW-2026-05-13.md`.
 */
@Injectable()
export class DocumentIntakeService {
  private readonly logger = new Logger(DocumentIntakeService.name);

  constructor(
    private readonly documentDispatcher: WhatsappDocumentDispatcherService,
    private readonly documentProcessor: WhatsappDocumentProcessorService,
    private readonly whatsappService: WhatsappService,
    private readonly conversationService: ConversationService,
    private readonly phoneNormalizer: PhoneNormalizerService,
  ) {}

  /**
   * Processa mídia de documento inbound (image/pdf) ou resposta a intent
   * pendente.
   *
   * Retorna `{ handled: true }` quando o turno deve ser encerrado sem passar
   * pelo LLM. Retorna `{ handled: false }` para deixar o orchestrator
   * continuar normalmente.
   *
   * Caso especial — bypass de assinatura: quando a imagem é reconhecida como
   * upload de assinatura digital, retorna `{ handled: false, syntheticBody }`
   * com um texto sintético que será usado como body pelo orchestrator (evita
   * o guard "Não consegui identificar texto" quando a imagem é enviada sem
   * caption).
   *
   * Pipeline (Sprint 1–3):
   * - Mídia nova → staging no Supabase tmp, salva pendência por telefone e
   *   envia mensagem de intent (1/2/3).
   * - Pendência ativa + "cancelar" → apaga staging + pendência.
   * - Pendência ativa + intent reconhecida → roda OCR + classifier; injeta
   *   resultado no histórico para o próximo turno do LLM.
   */
  async processInboundDocumentIfNeeded(opts: {
    phone: string;
    body: string;
    normalizedInput: string;
    messageSid: string;
    userId: string;
    ownerId?: string | null;
    conversationId?: string;
    media?: Array<{
      url: string;
      contentType: string | null;
      category: 'audio' | 'image' | 'pdf' | 'other';
      durationSeconds: number | null;
    }>;
  }): Promise<{ handled: boolean; syntheticBody?: string }> {
    if (!this.documentDispatcher.isEnabled()) {
      return { handled: false };
    }

    // 1) Tem mídia inbound de documento? Faz staging + intent prompt.
    const incomingDocMedia = this.documentDispatcher.pickDocumentMedia(
      opts.media as any,
    );
    if (incomingDocMedia) {
      // Bypass para upload de assinatura: a tool `upload_doctor_signature`
      // precisa receber a imagem como `inboundMedia`. Verificamos tanto a
      // caption atual quanto o histórico recente da conversa (cobre o caso em
      // que o usuário avisou que mandaria a assinatura num turno anterior e
      // enviou a imagem sem texto no turno seguinte).
      // PDFs nunca são assinaturas — bypass só se for imagem.
      if (
        incomingDocMedia.category === 'image' &&
        (await this.hasSignatureUploadIntent({
          body: opts.body,
          conversationId: opts.conversationId,
          messageSid: opts.messageSid,
          phone: opts.phone,
        }))
      ) {
        // Se a imagem veio sem caption, sintetizamos um body para o LLM não
        // cair no guard "Não consegui identificar texto na sua mensagem".
        const syntheticBody = opts.body.trim()
          ? undefined
          : 'Quero fazer upload da minha assinatura digital.';
        return { handled: false, syntheticBody };
      }

      const existingPending = await this.documentDispatcher.getPending(
        opts.phone,
      );
      if (existingPending) {
        await this.documentDispatcher.deleteStoragePath(
          existingPending.storagePath,
        );
        await this.documentDispatcher.clearPending(opts.phone);
      }

      const outcome = await this.documentDispatcher.stageInboundDocument({
        media: incomingDocMedia,
        phone: opts.phone,
        messageSid: opts.messageSid,
      });

      if (outcome.status === 'failed') {
        await this.whatsappService.sendMessage(
          opts.phone,
          this.documentDispatcher.buildDownloadFailureMessage(
            outcome.failureReason || 'UNKNOWN',
          ),
        );
        return { handled: true };
      }

      if (outcome.status === 'staged') {
        await this.whatsappService.sendMessage(
          opts.phone,
          this.documentDispatcher.buildIntentPromptMessage(),
        );
        return { handled: true };
      }

      return { handled: false };
    }

    // 2) Não tem mídia nova — verifica se há pendência ativa de turno
    //    anterior e se a mensagem é uma intent reconhecida.
    const pending = await this.documentDispatcher.getPending(opts.phone);
    if (!pending) return { handled: false };

    const intent = this.documentDispatcher.parseIntent(opts.body);
    if (!intent) {
      return { handled: false };
    }

    if (intent === 'cancel') {
      await this.documentDispatcher.deleteStoragePath(pending.storagePath);
      await this.documentDispatcher.clearPending(opts.phone);
      this.logger.log(
        `[AI_DOC_INTENT] sid=${opts.messageSid} phone=${this.phoneNormalizer.maskPhone(opts.phone)} intent=cancel`,
      );
      await this.whatsappService.sendMessage(
        opts.phone,
        'Tudo bem, descartei o arquivo enviado. Se quiser, é só mandar de novo quando precisar.',
      );
      return { handled: true };
    }

    this.logger.log(
      `[AI_DOC_INTENT] sid=${opts.messageSid} phone=${this.phoneNormalizer.maskPhone(opts.phone)} intent=${intent}`,
    );

    const isLiteralNumericChoice = /^[123]\b/.test((opts.body || '').trim());
    if (
      pending.classification &&
      pending.intent === intent &&
      pending.classifiedAt &&
      Date.now() - pending.classifiedAt < 5 * 60 * 1000 &&
      isLiteralNumericChoice
    ) {
      const cachedSummary = this.buildDocumentReminderMessage(intent, pending);
      await this.whatsappService.sendMessage(opts.phone, cachedSummary);
      if (opts.conversationId) {
        await this.conversationService.appendMessage(
          opts.conversationId,
          'assistant',
          cachedSummary,
        );
      }
      return { handled: true };
    }

    // Texto livre que casou com a intent E já tem classificação válida no
    // cache: não rerodamos OCR/LLM — deixamos o orchestrator continuar.
    if (
      pending.classification &&
      pending.intent === intent &&
      pending.classifiedAt &&
      Date.now() - pending.classifiedAt < 5 * 60 * 1000
    ) {
      this.logger.log(
        `[AI_DOC_INTENT] sid=${opts.messageSid} phone=${this.phoneNormalizer.maskPhone(opts.phone)} intent=${intent} reused_classification=true delegated_to_llm=true`,
      );
      return { handled: false };
    }

    const outcome = await this.documentProcessor.processPendingDocument({
      phone: opts.phone,
      pending,
      intent,
      conversationId: opts.conversationId ?? opts.phone,
      messageSid: opts.messageSid,
      userId: opts.userId,
      ownerId: opts.ownerId ?? null,
    });

    if (outcome.status !== 'ok' || !outcome.userSummary) {
      const errorMsg =
        outcome.errorMessage ||
        'Não consegui processar o arquivo agora. Tente reenviar em alguns instantes.';
      await this.whatsappService.sendMessage(opts.phone, errorMsg);
      if (opts.conversationId) {
        await this.conversationService.appendMessage(
          opts.conversationId,
          'assistant',
          errorMsg,
        );
      }
      return { handled: true };
    }

    await this.whatsappService.sendMessage(opts.phone, outcome.userSummary);
    if (opts.conversationId) {
      await this.conversationService.appendMessage(
        opts.conversationId,
        'assistant',
        outcome.userSummary,
      );
    }
    return { handled: true };
  }

  /**
   * Retorna `true` quando há evidência (na caption atual ou em mensagens
   * recentes da conversa) de que o usuário quer fazer upload da assinatura
   * digital, e NÃO de outro tipo de documento (RG, laudo, guia, etc.).
   *
   * Verifica em dois passos:
   * 1. Caption da mensagem atual — rápida e sem I/O extra.
   * 2. Últimas 3 mensagens do usuário na conversa — cobre o caso em que o
   *    usuário disse "vou mandar minha assinatura" num turno anterior e enviou
   *    a imagem sem texto no turno seguinte.
   */
  private async hasSignatureUploadIntent(opts: {
    body: string;
    conversationId?: string;
    messageSid: string;
    phone: string;
  }): Promise<boolean> {
    const signatureRe = /assinatura/i;
    // Palavras que indicam outro tipo de documento — evita falso bypass
    const otherDocRe =
      /\b(identidade|rg\b|cpf\b|passaporte|laudo|guia|exame|certid[aã]o|prontu[aá]rio|nota\s*fiscal|receita|relat[oó]rio)\b/i;

    const caption = (opts.body || '').trim();

    // 1) Caption explicitamente indica outro tipo de documento → não bypassa
    if (otherDocRe.test(caption)) return false;

    // 2) Caption menciona "assinatura" → bypassa
    if (signatureRe.test(caption)) {
      this.logger.log(
        `[AI_DOC] sid=${opts.messageSid} phone=${this.phoneNormalizer.maskPhone(opts.phone)} bypassed=signature_upload source=caption`,
      );
      return true;
    }

    // 3) Sem match na caption — verifica histórico recente da conversa
    if (!opts.conversationId) return false;
    try {
      const recent = await this.conversationService.loadRecentForLlm(
        opts.conversationId,
        8,
      );
      // Analisa as últimas 3 mensagens do USUÁRIO (cobre "vou mandar minha
      // assinatura" sem foto seguido pela foto no turno seguinte)
      const recentUserMsgs = recent.filter((m) => m.role === 'user').slice(-3);
      const hasRecentSignatureIntent = recentUserMsgs.some(
        (m) => signatureRe.test(m.content) && !otherDocRe.test(m.content),
      );
      if (hasRecentSignatureIntent) {
        this.logger.log(
          `[AI_DOC] sid=${opts.messageSid} phone=${this.phoneNormalizer.maskPhone(opts.phone)} bypassed=signature_upload source=conversation_history`,
        );
        return true;
      }

      // 4) Cobre o caso simétrico: o ASSISTENTE acabou de pedir a foto
      //    da assinatura (ex.: "envie a imagem da sua assinatura aqui no
      //    chat") e o usuário responde mandando a imagem sem caption.
      //    Sem isso, o pipeline genérico mostra "1=anexar / 2=criar SC /
      //    3=cadastrar paciente" — confundindo totalmente o usuário.
      const lastAssistantMsg = [...recent]
        .reverse()
        .find((m) => m.role === 'assistant');
      if (
        lastAssistantMsg &&
        signatureRe.test(lastAssistantMsg.content) &&
        !otherDocRe.test(lastAssistantMsg.content)
      ) {
        this.logger.log(
          `[AI_DOC] sid=${opts.messageSid} phone=${this.phoneNormalizer.maskPhone(opts.phone)} bypassed=signature_upload source=last_assistant_message`,
        );
        return true;
      }
    } catch {
      // Falha não-crítica: continua com o pipeline normal de documento
    }
    return false;
  }

  /**
   * Hint injetado no system prompt quando há um documento pendente já
   * classificado para o telefone. Dá ao LLM o resumo extraído, a intent
   * declarada e instrução determinística de qual tool chamar.
   *
   * Retorna `null` quando não há pendência classificada ou quando o
   * documento foi processado há > 5 min.
   */
  async buildDocumentPendingHint(phone: string): Promise<string | null> {
    try {
      const pending = await this.documentDispatcher.getPending(phone);
      if (!pending || !pending.classification || !pending.intent) return null;
      if (
        !pending.classifiedAt ||
        Date.now() - pending.classifiedAt > 5 * 60 * 1000
      ) {
        return null;
      }

      const cls = pending.classification;
      const extracted = cls.extracted || {};
      const dataLines: string[] = [];
      if (extracted.patient?.name)
        dataLines.push(`  - Paciente: ${extracted.patient.name}`);
      if (extracted.patient?.cpf)
        dataLines.push(`  - CPF: ${extracted.patient.cpf}`);
      if (extracted.patient?.birthDate)
        dataLines.push(`  - Nascimento: ${extracted.patient.birthDate}`);
      if (extracted.patient?.phone)
        dataLines.push(`  - Telefone: ${extracted.patient.phone}`);
      if (extracted.patient?.rg)
        dataLines.push(`  - RG: ${extracted.patient.rg}`);
      if (extracted.hospital)
        dataLines.push(`  - Hospital: ${extracted.hospital}`);
      if (extracted.healthPlan?.name)
        dataLines.push(`  - Convênio: ${extracted.healthPlan.name}`);
      if (extracted.diagnosis)
        dataLines.push(`  - Diagnóstico: ${extracted.diagnosis}`);
      if (extracted.suggestedProcedureName)
        dataLines.push(
          `  - Procedimento sugerido: ${extracted.suggestedProcedureName}`,
        );
      if (extracted.tuss?.length)
        dataLines.push(
          `  - TUSS: ${extracted.tuss.map((t: any) => `${t.code}${t.description ? ` (${t.description})` : ''}`).join(', ')}`,
        );
      if (extracted.cid?.length)
        dataLines.push(
          `  - CID: ${extracted.cid.map((c: any) => c.code).join(', ')}`,
        );
      if (extracted.opme?.length)
        dataLines.push(
          `  - OPME: ${extracted.opme
            .map((o: any) => {
              const tag = [o.supplier, o.brand].filter(Boolean).join('/');
              return `${o.qty || 1}x ${o.description}${tag ? ` [${tag}]` : ''}`;
            })
            .join('; ')}`,
        );
      if (extracted.suggestedSuppliers?.length)
        dataLines.push(
          `  - Fornecedores sugeridos: ${extracted.suggestedSuppliers.join(', ')}`,
        );
      if (extracted.laudoText)
        dataLines.push(
          `  - Laudo (texto completo, copie para draft_update({ fields: { notes } })): "${extracted.laudoText.replace(/"/g, "'").slice(0, 600)}${extracted.laudoText.length > 600 ? '…[truncado para o hint, original disponível em pending.classification.extracted.laudoText]' : ''}"`,
        );

      const dataBlock = dataLines.length
        ? dataLines.join('\n')
        : '  (poucos dados confiáveis foram extraídos do documento)';

      const hasRich =
        pending.intent === 'create_sc' &&
        !!extracted.patient?.name &&
        (!!extracted.suggestedProcedureName ||
          (extracted.tuss?.length ?? 0) > 0) &&
        (!!extracted.healthPlan?.name ||
          (extracted.opme?.length ?? 0) > 0 ||
          !!extracted.diagnosis ||
          !!extracted.laudoText);

      const intentInstruction = (() => {
        switch (pending.intent) {
          case 'attach':
            return [
              '- A intenção declarada é **anexar** este documento a uma SC existente.',
              '- Se o usuário disser "sim"/"pode anexar"/"vai" sem informar SC, peça o protocolo (ex.: SC-1234) ou ofereça `query_surgery_requests` para escolher.',
              '- Quando souber a SC, chame `attach_document_from_whatsapp` com `surgeryRequestId`, `documentType` (default `medical_report` para laudos, `personal_document` para RG, `authorization_guide` para guia, etc.) e `confirm: false` para preview; depois `confirm: true`.',
              '- NÃO peça os dados do documento de novo: eles já estão extraídos acima.',
            ].join('\n');
          case 'create_sc':
            if (hasRich) {
              return [
                '- A intenção declarada é **criar uma nova SC** e o documento trouxe DADOS SUFICIENTES (paciente + procedimento/TUSS + contexto).',
                '- **MODO AUTO-CRIAR ATIVADO**: NÃO pergunte "posso seguir?" / "qual o nome do paciente?" / "qual o procedimento?". Os dados já estão acima. Vá DIRETO para o draft:',
                '  1. `plan_actions({ intent: "create_sc" })` para abrir o rascunho.',
                '  2. Resolva o paciente: chame `query_patients({ patient_name_or_id: "<nome acima>", match_mode: "fuzzy" })`. Se a tool retornar um único match → use `draft_update({ fields: { patientId: "<id>" } })`. Se retornar lista ambígua → mostre ao usuário e peça desempate. Se NÃO encontrar nada → chame `create_patient_from_document({ confirm: true })` (use telefone/e-mail extraídos; se faltarem os obrigatórios, pergunte só esses dois).',
                '  3. `draft_update({ fields: { procedure_name: "<sugerido acima>" } })`.',
                '  4. `draft_update({ fields: { health_plan_name: "...", hospital_name: "..." } })` com o convênio (e hospital, se houver) listado acima.',
                '  5. `draft_update({ fields: { notes: "<laudoText acima>" } })` colando o LAUDO INTEIRO.',
                '  6. Se houver TUSS ou OPME nos dados acima, registre via tools `manage_tuss_items` / `manage_opme_items` (após o commit da SC) ou cole no `notes` se preferir.',
                '  7. `sc_draft_preview` → mostre ao usuário o resumo de UMA vez. Aí sim peça confirmação final ("posso salvar?").',
                '  8. Após confirmação, `sc_draft_commit`.',
                '- NUNCA fragmente em perguntas separadas para cada campo quando os dados já estão extraídos. NUNCA responda "não ficou claro qual ação você quer confirmar" enquanto este hint estiver ativo.',
                '- Se alguma tool falhar com erro técnico, NÃO repasse o erro cru ao usuário; tente seguir adiante com o que conseguiu coletar e peça ajuda apenas para o que ficou faltando.',
              ].join('\n');
            }
            return [
              '- A intenção declarada é **criar uma nova SC** a partir deste documento, mas faltam alguns dados-chave.',
              '- Quando o usuário confirmar (sim/pode/vai), use o fluxo de rascunho: `plan_actions({ intent: "create_sc" })` → `draft_update({ fields: { patientId | patient_name, procedure_name, hospital_name?, health_plan_name? } })` — usando os DADOS EXTRAÍDOS acima como base e completando com o que vier do usuário.',
              '- Para resolver o paciente pelo nome, chame `query_patients({ patient_name_or_id: "<nome>", match_mode: "fuzzy" })`. Se não existir, ofereça criar via `create_patient_from_document` antes de continuar a SC.',
              '- Se faltar hospital/convênio/procedimento no catálogo, abra um sub-draft com `plan_actions(intent="create_hospital"|"create_health_plan"|"create_procedure")` e preencha o sub-draft com `draft_update` antes do draft pai.',
              '- Cole o `laudoText` (se houver) em `draft_update({ fields: { notes } })`.',
              '- Quando o draft estiver completo, chame `sc_draft_preview` e `sc_draft_commit`.',
              '- NUNCA responda "não ficou claro qual ação você quer confirmar" enquanto este hint estiver ativo: a ação JÁ está clara — é criar a SC.',
            ].join('\n');
          case 'create_patient':
            return [
              '- A intenção declarada é **cadastrar um paciente novo** a partir deste documento.',
              '- Quando o usuário confirmar (sim/pode/vai), chame `create_patient_from_document` com `confirm: false` para mostrar preview; após o usuário confirmar de novo, chame com `confirm: true`.',
              '- Use os dados extraídos como base. Se telefone/e-mail estiverem faltando (são obrigatórios), peça-os antes.',
              '- NUNCA responda "não ficou claro qual ação você quer confirmar" enquanto este hint estiver ativo: a ação JÁ está clara — é criar o paciente.',
            ].join('\n');
          default:
            return '';
        }
      })();

      const ambiguityNote = cls.ambiguity
        ? `\n- ATENÇÃO: o classificador marcou ambiguidade ("${cls.ambiguity}"). Confirme com o usuário antes de criar registros.`
        : '';

      return [
        'CONTEXTO DETERMINÍSTICO — DOCUMENTO PENDENTE:',
        `- O usuário enviou um documento classificado como **${cls.kind}** (tipo sugerido: ${cls.suggestedDocumentType}). NÃO mencione "confiança" / "porcentagem" / "score" do classificador para o usuário.`,
        '- Dados extraídos (já tokenizados pela camada PII — preserve placeholders `{{categoria_n}}` ao chamar tools):',
        dataBlock,
        intentInstruction + ambiguityNote,
      ].join('\n');
    } catch (err: any) {
      this.logger.warn(
        `[AI_DOC_PENDING_HINT] erro ao montar hint: ${err?.message || 'erro desconhecido'}`,
      );
      return null;
    }
  }

  /**
   * Quando o usuário responde a intent uma segunda vez, devolve um resumo
   * encurtado sem chamar OCR/LLM novamente.
   */
  buildDocumentReminderMessage(
    intent: 'attach' | 'create_sc' | 'create_patient',
    pending: any,
  ): string {
    const classification = pending.classification;
    const kindLabel = classification?.kind ?? 'documento';
    const lines: string[] = [
      `Já analisei o documento (${kindLabel}). O que devo fazer agora?`,
    ];
    switch (intent) {
      case 'attach':
        lines.push(
          'Me diga o protocolo da SC (ex.: SC-1234) onde anexar, ou peça para listar suas SCs ativas.',
        );
        break;
      case 'create_sc':
        lines.push(
          'Responda "sim" para iniciar o rascunho da nova SC com os dados extraídos.',
        );
        break;
      case 'create_patient':
        lines.push(
          'Responda "sim" para confirmar o cadastro do paciente com os dados extraídos.',
        );
        break;
    }
    return lines.join('\n');
  }
}
