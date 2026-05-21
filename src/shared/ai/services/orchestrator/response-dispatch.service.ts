import { Injectable, Logger } from '@nestjs/common';
import { ConversationService } from '../conversation.service';
import { WhatsappService } from '../../../whatsapp/whatsapp.service';
import { PiiVaultService } from '../pii-vault.service';
import {
  MAX_RESPONSE_LENGTH,
  ResponseNormalizerService,
} from './response-normalizer.service';
import { PhoneNormalizerService } from './phone-normalizer.service';
import { WHATSAPP_TEMPLATES } from '../../../whatsapp/whatsapp-templates.constants';
import { OperationDraftType } from '../../drafts/operation-draft.types';
import { ToolLoopResult } from './tool-loop-runner.service';

export interface DispatchParams {
  phone: string;
  conversationId: string;
  messageSid: string;
  loopResult: ToolLoopResult;
}

/**
 * Finaliza o ciclo de resposta do orchestrator:
 * 1. Constrói o texto final (fallback contextual se o loop estourou).
 * 2. Normaliza para WhatsApp e trunca se necessário.
 * 3. Sanitiza literais de PII e persiste no histórico conversacional.
 * 4. Detokeniza e faz scrub de placeholders residuais antes de enviar.
 * 5. Envia a resposta via WhatsApp e tenta o template de confirmação.
 *
 * Extraído de `AiOrchestratorService` para reduzir o tamanho do
 * coordenador principal.
 */
@Injectable()
export class ResponseDispatchService {
  private readonly logger = new Logger(ResponseDispatchService.name);

  constructor(
    private readonly conversationService: ConversationService,
    private readonly whatsappService: WhatsappService,
    private readonly piiVault: PiiVaultService,
    private readonly responseNormalizer: ResponseNormalizerService,
    private readonly phoneNormalizer: PhoneNormalizerService,
  ) {}

  async dispatch(params: DispatchParams): Promise<void> {
    const { phone, conversationId, messageSid, loopResult } = params;
    const { responseMessage, loopLimitReached, pendingToolNames, activeDraftType } =
      loopResult;

    const trimmedContent = responseMessage.content?.trim() ?? '';
    let finalText: string;

    if (loopLimitReached && !trimmedContent) {
      finalText = this.buildLoopLimitFallback(pendingToolNames, activeDraftType);
    } else {
      finalText =
        trimmedContent ||
        'Posso te ajudar com algo específico? Me diga em poucas palavras o que precisa que eu sigo daí.';
    }

    finalText = this.responseNormalizer.normalizeWhatsappText(finalText);

    if (finalText.length > MAX_RESPONSE_LENGTH) {
      finalText =
        finalText.slice(0, MAX_RESPONSE_LENGTH - 60) +
        '...\n\n_Acesse a plataforma para ver a resposta completa._';
    }

    // Persiste no histórico com literais de PII mascarados
    const sanitizedHistoryText = this.sanitizeForHistory(
      finalText,
      conversationId,
      messageSid,
    );
    await this.conversationService.appendMessage(
      conversationId,
      'assistant',
      sanitizedHistoryText,
    );

    // Detokeniza apenas para envio externo (WhatsApp)
    const detokenized = this.piiVault.detokenize(conversationId, finalText);
    const scrubbed = this.responseNormalizer.scrubResidualPlaceholders(
      detokenized,
      conversationId,
      messageSid,
    );
    const safeText = this.responseNormalizer.collapseSCPrefixes(
      scrubbed,
      conversationId,
      messageSid,
    );

    await this.whatsappService.sendMessage(phone, safeText);
    await this.trySendConfirmationTemplate(phone, safeText);

    const maskedPhone = this.phoneNormalizer.maskPhone(phone);
    this.logger.log(`Resposta enviada para ${maskedPhone} (${safeText.length} chars)`);
  }

  private sanitizeForHistory(
    text: string,
    conversationId: string,
    messageSid: string,
  ): string {
    if (!text) return text;
    const result = this.piiVault.maskLiteralPii(text);
    if (result.masked.length) {
      const breakdown = result.masked
        .map((entry: any) => `${entry.category}=${entry.count}`)
        .join(',');
      this.logger.warn(
        `[AI_ASSISTANT_PII_MASK] sid=${messageSid} conv=${conversationId} ${breakdown}`,
      );
    }
    return this.responseNormalizer.collapseSCPrefixes(
      result.text,
      conversationId,
      messageSid,
    );
  }

  private async trySendConfirmationTemplate(
    phone: string,
    finalText: string,
  ): Promise<boolean> {
    if (!this.responseNormalizer.isConfirmationPrompt(finalText)) return false;

    const contentSid = WHATSAPP_TEMPLATES.AI_ACTION_CONFIRMATION;
    if (!contentSid) return false;

    try {
      await this.whatsappService.sendTemplate(phone, contentSid, { '1': finalText });
      return true;
    } catch (error: any) {
      this.logger.warn(
        `Falha ao enfileirar template interativo de confirmação para ${this.phoneNormalizer.maskPhone(phone)}: ${error?.message || 'erro desconhecido'}`,
      );
      return false;
    }
  }

  private buildLoopLimitFallback(
    pendingToolNames: string[],
    activeDraftType: OperationDraftType | null,
  ): string {
    const lastTool = pendingToolNames[pendingToolNames.length - 1] ?? '';

    if (lastTool.startsWith('send_sc_draft') || activeDraftType === 'send_sc') {
      return 'Tive uma dificuldade técnica para concluir o envio da solicitação. Posso tentar de novo? Se preferir, me diga o método (e-mail ou download).';
    }
    if (lastTool.startsWith('sc_draft') || activeDraftType === 'create_sc') {
      return 'Tive uma dificuldade técnica para finalizar a criação da solicitação. Me diga se quer que eu tente de novo ou se prefere ajustar algum dado antes.';
    }
    if (lastTool.startsWith('invoice_draft') || activeDraftType === 'invoice') {
      return 'Tive uma dificuldade técnica para registrar a fatura. Quer que eu tente novamente?';
    }
    if (
      lastTool.startsWith('contestation_draft') ||
      activeDraftType === 'contestation'
    ) {
      return 'Tive uma dificuldade técnica para registrar a contestação. Quer que eu tente de novo?';
    }
    if (
      lastTool.startsWith('scheduling_draft') ||
      activeDraftType === 'scheduling'
    ) {
      return 'Tive uma dificuldade técnica para registrar o agendamento. Posso tentar de novo?';
    }
    if (lastTool === 'upload_doctor_signature') {
      return 'Não consegui concluir o upload da assinatura agora. Me envie a foto novamente e eu registro.';
    }

    return 'Tive uma dificuldade técnica para concluir essa ação. Me diga em poucas palavras o que precisa e eu sigo daí.';
  }
}
