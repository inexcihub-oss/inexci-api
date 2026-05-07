import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OpenaiService } from './openai.service';
import { ConversationService } from './conversation.service';
import { ToolRegistryService } from './tool-registry.service';
import { ToolExecutorService } from './tool-executor.service';
import { RagService } from '../../rag/rag.service';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { UserRepository } from '../../../database/repositories/user.repository';
import { User } from '../../../database/entities/user.entity';
import { AccessControlService } from '../../services/access-control.service';
import { ToolContext } from '../tools/tool.interface';
import { SYSTEM_PROMPT } from '../prompts/system-prompt';
import { PendencyValidatorService } from '../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { AiTokenUsageLogRepository } from '../../../database/repositories/ai-token-usage-log.repository';

const MAX_TOOL_ITERATIONS = 5;
const MAX_RESPONSE_LENGTH = 1000;
const WHATSAPP_TARGET_LENGTH = 700;
const CLEAR_CONTEXT_CONFIRMATION_TTL_MS = 10 * 60 * 1000;

const CLEAR_CONTEXT_EXACT_COMMANDS = new Set<string>([
  'limpar contexto',
  'limpar o contexto',
  'limpar conversa',
  'limpar a conversa',
  'limpar contexto da conversa',
  'limpar historico',
  'limpar histórico',
  'limpar o historico',
  'limpar o histórico',
  'limpar historico da conversa',
  'limpar histórico da conversa',
  'limpar chat',
  'limpar o chat',
  'apagar contexto',
  'apagar historico',
  'apagar histórico',
  'resetar contexto',
  'resetar conversa',
  'sair da conversa',
  'sair do chat',
  'encerrar conversa',
  'encerrar chat',
  'fechar conversa',
  'nova conversa',
  'comecar nova conversa',
  'começar nova conversa',
  'finalizar conversa',
]);

interface CompletionUsageSnapshot {
  stage: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface PendingClearContextConfirmation {
  conversationId: string;
  expiresAt: number;
}

const MUTATION_TOOL_NAMES = new Set<string>([
  'create_surgery_request_from_whatsapp',
  'create_sc_catalog_record',
  'advance_surgery_request',
  'set_has_opme',
  'close_surgery_request',
  'update_surgery_request_data',
  'confirm_date',
  'update_date_options',
  'reschedule_surgery',
  'mark_performed',
  'invoice_request',
  'confirm_receipt',
  'contest_authorization_full',
  'contest_payment',
  'update_receipt',
  'manage_report_sections',
  'update_patient_data',
  'set_hospital',
  'add_tuss_item',
  'add_opme_item',
  'update_request_clinical_data',
  'update_request_admin_data',
  'attach_document_from_whatsapp',
]);

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class SimpleCache<T> {
  private store = new Map<string, CacheEntry<T>>();

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}

@Injectable()
export class AiOrchestratorService {
  private readonly logger = new Logger(AiOrchestratorService.name);
  private readonly userCache = new SimpleCache<any>();
  private readonly doctorIdsCache = new SimpleCache<string[]>();
  private readonly pendingClearContextByPhone = new Map<
    string,
    PendingClearContextConfirmation
  >();
  private readonly rateLimitCounts = new Map<
    string,
    { count: number; resetAt: number }
  >();

  constructor(
    @InjectQueue('ai-messages') private readonly aiQueue: Queue,
    private readonly openaiService: OpenaiService,
    private readonly conversationService: ConversationService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly toolExecutor: ToolExecutorService,
    private readonly ragService: RagService,
    private readonly whatsappService: WhatsappService,
    private readonly userRepository: UserRepository,
    private readonly accessControlService: AccessControlService,
    private readonly pendencyValidator: PendencyValidatorService,
    private readonly surgeryRequestRepo: SurgeryRequestRepository,
    private readonly aiTokenUsageLogRepo: AiTokenUsageLogRepository,
    private readonly configService: ConfigService,
  ) {}

  async enqueueInboundMessage(data: {
    from: string;
    body: string;
    messageSid: string;
    mediaUrl: string | null;
    media?: Array<{ url: string; contentType: string | null }>;
  }): Promise<void> {
    await this.aiQueue.add('process-message', data, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: true,
    });
  }

  async processMessage(data: {
    from: string;
    body: string;
    messageSid: string;
    mediaUrl: string | null;
    media?: Array<{ url: string; contentType: string | null }>;
  }): Promise<void> {
    const processTimeoutMs = this.configService.get<number>(
      'AI_PROCESS_TIMEOUT_MS',
      90000,
    );
    const processStartedAt = Date.now();

    const { canonicalPhone, lookupCandidates } = this.normalizeInboundPhone(
      data.from,
    );
    const phone = canonicalPhone;
    this.logger.log(
      `Processando mensagem de ${phone}: "${data.body.slice(0, 50)}"`,
    );

    if (!this.checkRateLimit(phone)) {
      this.logger.warn(`Rate limit excedido para ${phone}`);
      await this.whatsappService.sendMessage(
        phone,
        '⚠️ Você enviou muitas mensagens. Por favor, aguarde alguns minutos antes de tentar novamente.',
      );
      return;
    }

    try {
      this.ensureWithinTimeout(processStartedAt, processTimeoutMs);

      const usageSnapshots: CompletionUsageSnapshot[] = [];

      const cachedUser = this.userCache.get(phone);
      const user =
        cachedUser ??
        (await this.findUserByPhoneCandidates(phone, lookupCandidates));
      if (user && !cachedUser) this.userCache.set(phone, user, 10 * 60 * 1000); // 10 min

      const userId = user?.id || null;

      if (!userId) {
        await this.handleUnknownUser(
          phone,
          data.body,
          processStartedAt,
          processTimeoutMs,
        );
        return;
      }

      const cachedDoctorIds = this.doctorIdsCache.get(userId);
      const accessibleDoctorIds =
        cachedDoctorIds ??
        (await this.accessControlService.getAccessibleDoctorIds(userId));
      if (!cachedDoctorIds)
        this.doctorIdsCache.set(userId, accessibleDoctorIds, 5 * 60 * 1000); // 5 min

      const conversation =
        await this.conversationService.getOrCreateConversation(phone, userId);

      const normalizedInput = this.normalizeIntentText(data.body);

      if (this.isClearContextCommand(normalizedInput)) {
        this.pendingClearContextByPhone.set(phone, {
          conversationId: conversation.id,
          expiresAt: Date.now() + CLEAR_CONTEXT_CONFIRMATION_TTL_MS,
        });
        await this.whatsappService.sendMessage(
          phone,
          'Confirma que deseja limpar o contexto desta conversa? As próximas mensagens serão tratadas sem histórico anterior. Responda "sim" para confirmar ou "não" para cancelar.',
        );
        return;
      }

      const pendingClear = this.getPendingClearContext(phone);
      if (pendingClear) {
        if (this.isConfirmationInput(normalizedInput)) {
          await this.conversationService.resetConversationHistory(
            pendingClear.conversationId,
          );
          this.pendingClearContextByPhone.delete(phone);
          await this.whatsappService.sendMessage(
            phone,
            'Pronto. Limpei o contexto desta conversa. Precisa de mais alguma coisa? Se precisar, é só chamar.',
          );
          return;
        }

        if (this.isCancelConfirmationInput(normalizedInput)) {
          this.pendingClearContextByPhone.delete(phone);
          await this.whatsappService.sendMessage(
            phone,
            'Tudo bem, não limpei o contexto. Se quiser limpar depois, é só pedir.',
          );
          return;
        }

        await this.whatsappService.sendMessage(
          phone,
          'Ainda estou aguardando sua confirmação para limpar o contexto. Responda "sim" para confirmar ou "não" para cancelar.',
        );
        return;
      }

      await this.conversationService.appendMessage(
        conversation.id,
        'user',
        data.body,
      );

      // RAG
      const ragResults = await this.ragService.search(data.body, 3, 0.65);
      const ragContext = await this.ragService.formatContext(ragResults);

      const updatedConv =
        await this.conversationService.getOrCreateConversation(phone, userId);
      const messages = this.conversationService.buildMessagesForOpenAI(
        updatedConv,
        ragContext,
      );

      const tools = this.toolRegistry.getToolDefinitions();

      this.ensureWithinTimeout(processStartedAt, processTimeoutMs);
      const completion = await this.openaiService.chatCompletion({
        messages,
        tools,
        temperature: 0.2,
        timeoutMs: this.getRemainingTimeoutMs(
          processStartedAt,
          processTimeoutMs,
        ),
      });
      this.captureUsageSnapshot(usageSnapshots, 'initial', completion);
      let responseMessage = completion.choices[0].message;

      const toolContext: ToolContext = {
        userId,
        phone,
        accessibleDoctorIds,
        conversationId: conversation.id,
        inboundMedia: data.media || [],
      };

      let iterations = MAX_TOOL_ITERATIONS;
      let followUpIndex = 0;
      while (responseMessage.tool_calls?.length && iterations > 0) {
        iterations--;

        const toolResults = await this.toolExecutor.executeMany(
          responseMessage.tool_calls,
          toolContext,
        );

        const patchedToolResults = await Promise.all(
          toolResults.map(async (result) => {
            const toolCall = responseMessage.tool_calls?.find(
              (call) => call.id === result.toolCallId,
            );

            if (!toolCall) return result;

            const functionName = toolCall.function?.name || '';
            let args: Record<string, any> = {};

            try {
              args = toolCall.function?.arguments
                ? JSON.parse(toolCall.function.arguments)
                : {};
            } catch {
              return result;
            }

            const enrichedOutput = await this.appendNextStepIfNeeded(
              functionName,
              args,
              result.output,
              toolContext,
            );

            return {
              ...result,
              output: enrichedOutput,
            };
          }),
        );

        messages.push(responseMessage as OpenAI.ChatCompletionMessageParam);
        for (const result of patchedToolResults) {
          messages.push({
            role: 'tool',
            tool_call_id: result.toolCallId,
            content: result.output,
          });
        }

        const followUp = await this.openaiService.chatCompletion({
          messages,
          tools,
          temperature: 0.2,
          timeoutMs: this.getRemainingTimeoutMs(
            processStartedAt,
            processTimeoutMs,
          ),
        });
        followUpIndex += 1;
        this.captureUsageSnapshot(
          usageSnapshots,
          `followup_${followUpIndex}`,
          followUp,
        );
        responseMessage = followUp.choices[0].message;
      }

      let finalText =
        responseMessage.content ||
        'Desculpe, não consegui processar sua solicitação.';

      if (this.needsQualityRewrite(finalText)) {
        const rewriteResult = await this.rewriteForWhatsappQuality(
          finalText,
          data.body,
          processStartedAt,
          processTimeoutMs,
        );
        finalText = rewriteResult.text;
        this.captureUsageSnapshot(
          usageSnapshots,
          'rewrite',
          rewriteResult.completion,
        );
      }

      finalText = this.normalizeWhatsappText(finalText);

      if (finalText.length > MAX_RESPONSE_LENGTH) {
        finalText =
          finalText.slice(0, MAX_RESPONSE_LENGTH - 60) +
          '...\n\n_Acesse a plataforma para ver a resposta completa._';
      }

      await this.conversationService.appendMessage(
        conversation.id,
        'assistant',
        finalText,
      );

      await this.whatsappService.sendMessage(phone, finalText);

      await this.persistUsageSummary(
        phone,
        data.messageSid,
        conversation.id,
        userId,
        usageSnapshots,
      );

      this.logUsageSummary(phone, data.messageSid, usageSnapshots);

      this.logger.log(
        `Resposta enviada para ${phone} (${finalText.length} chars)`,
      );
    } catch (error: any) {
      this.logger.error(
        `Erro ao processar mensagem de ${phone}: ${error.message}`,
        error.stack,
      );
      const isTimeout =
        error?.code === 'AI_PROCESS_TIMEOUT' ||
        error?.code === 'ETIMEDOUT' ||
        error?.code === 'ECONNABORTED' ||
        error?.name === 'AbortError';

      await this.whatsappService.sendMessage(
        phone,
        isTimeout
          ? '⚠️ A solicitação demorou mais do que o esperado (1 min e 30 s) e foi cancelada. Tente novamente.'
          : '⚠️ Desculpe, estou com dificuldades técnicas no momento. Por favor, tente novamente em alguns minutos ou acesse a plataforma web.',
      );
    }
  }

  private checkRateLimit(phone: string, maxPerHour = 30): boolean {
    const now = Date.now();
    const entry = this.rateLimitCounts.get(phone);

    if (!entry || now > entry.resetAt) {
      this.rateLimitCounts.set(phone, { count: 1, resetAt: now + 3600_000 });
      return true;
    }

    entry.count++;
    return entry.count <= maxPerHour;
  }

  private async handleUnknownUser(
    phone: string,
    message: string,
    processStartedAt?: number,
    processTimeoutMs?: number,
  ): Promise<void> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'system',
        content:
          'ATENÇÃO: Este usuário NÃO está cadastrado no sistema. Responda APENAS perguntas gerais sobre a Inexci. NÃO use nenhuma ferramenta. Oriente-o a se cadastrar na plataforma web para acessar funcionalidades completas.',
      },
      { role: 'user', content: message },
    ];

    const completion = await this.openaiService.chatCompletion({
      messages,
      timeoutMs:
        processStartedAt && processTimeoutMs
          ? this.getRemainingTimeoutMs(processStartedAt, processTimeoutMs)
          : undefined,
    });
    const text = this.normalizeWhatsappText(
      completion.choices[0].message.content ||
        'Olá! Para utilizar nossos serviços, você precisa estar cadastrado na plataforma Inexci.',
    );

    await this.whatsappService.sendMessage(phone, text);
  }

  private needsQualityRewrite(text: string): boolean {
    if (!text) return true;

    const hasCodeBlock = text.includes('```');
    const hasMarkdownHeader = /^\s*#/m.test(text);
    const hasJsonLikePayload = /\{\s*"[^"]+"\s*:/m.test(text);
    const tooManyBreaks = (text.match(/\n/g) || []).length > 10;
    const tooLong = text.length > 900;

    return (
      hasCodeBlock ||
      hasMarkdownHeader ||
      hasJsonLikePayload ||
      tooManyBreaks ||
      tooLong
    );
  }

  private async rewriteForWhatsappQuality(
    rawText: string,
    userInput: string,
    processStartedAt?: number,
    processTimeoutMs?: number,
  ): Promise<{ text: string; completion: OpenAI.ChatCompletion | null }> {
    try {
      const completion = await this.openaiService.chatCompletion({
        temperature: 0.1,
        maxTokens: 350,
        timeoutMs:
          processStartedAt && processTimeoutMs
            ? this.getRemainingTimeoutMs(processStartedAt, processTimeoutMs)
            : undefined,
        messages: [
          {
            role: 'system',
            content:
              'Reescreva a resposta para WhatsApp em português do Brasil, mantendo apenas os fatos já presentes. Não adicione informações novas. Use tom profissional, linguagem direta, no máximo 6 linhas, sem emojis, sem markdown avançado e sem JSON.',
          },
          {
            role: 'user',
            content: `Pergunta do usuário: ${userInput}\n\nResposta bruta:\n${rawText}`,
          },
        ],
      });

      return {
        text:
          completion.choices[0]?.message?.content?.trim() ||
          rawText ||
          'Desculpe, não consegui formatar a resposta agora.',
        completion,
      };
    } catch {
      return { text: rawText, completion: null };
    }
  }

  private getRemainingTimeoutMs(
    startedAt: number,
    totalTimeoutMs: number,
  ): number {
    const elapsed = Date.now() - startedAt;
    const remaining = totalTimeoutMs - elapsed;
    if (remaining <= 0) {
      const err: any = new Error(
        `AI processing timeout after ${totalTimeoutMs}ms`,
      );
      err.code = 'AI_PROCESS_TIMEOUT';
      throw err;
    }
    return remaining;
  }

  private ensureWithinTimeout(startedAt: number, totalTimeoutMs: number): void {
    this.getRemainingTimeoutMs(startedAt, totalTimeoutMs);
  }

  private captureUsageSnapshot(
    snapshots: CompletionUsageSnapshot[],
    stage: string,
    completion: OpenAI.ChatCompletion | null | undefined,
  ): void {
    if (!completion?.usage) return;

    snapshots.push({
      stage,
      promptTokens: completion.usage.prompt_tokens || 0,
      completionTokens: completion.usage.completion_tokens || 0,
      totalTokens: completion.usage.total_tokens || 0,
    });
  }

  private logUsageSummary(
    phone: string,
    messageSid: string,
    snapshots: CompletionUsageSnapshot[],
  ): void {
    if (!snapshots.length) return;

    const totals = snapshots.reduce(
      (acc, item) => {
        acc.prompt += item.promptTokens;
        acc.completion += item.completionTokens;
        acc.total += item.totalTokens;
        return acc;
      },
      { prompt: 0, completion: 0, total: 0 },
    );

    const breakdown = snapshots
      .map(
        (item) =>
          `${item.stage}(p:${item.promptTokens}, c:${item.completionTokens}, t:${item.totalTokens})`,
      )
      .join(' | ');

    this.logger.log(
      `[AI_TOKEN_USAGE] sid=${messageSid} phone=${phone} total_prompt=${totals.prompt} total_completion=${totals.completion} total=${totals.total} breakdown=${breakdown}`,
    );
  }

  private async persistUsageSummary(
    phone: string,
    messageSid: string,
    conversationId: string,
    userId: string,
    snapshots: CompletionUsageSnapshot[],
  ): Promise<void> {
    if (!snapshots.length) return;

    const totals = snapshots.reduce(
      (acc, item) => {
        acc.prompt += item.promptTokens;
        acc.completion += item.completionTokens;
        acc.total += item.totalTokens;
        return acc;
      },
      { prompt: 0, completion: 0, total: 0 },
    );

    try {
      await this.aiTokenUsageLogRepo.create({
        messageSid,
        phone,
        conversationId,
        userId,
        promptTokens: totals.prompt,
        completionTokens: totals.completion,
        totalTokens: totals.total,
        callsCount: snapshots.length,
        breakdown: snapshots,
      });
    } catch (error: any) {
      this.logger.warn(
        `Falha ao persistir AI_TOKEN_USAGE sid=${messageSid}: ${error?.message || 'erro desconhecido'}`,
      );
    }
  }

  private normalizeWhatsappText(text: string): string {
    const normalizedLines = (text || '')
      .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
      .replace(/\r\n/g, '\n')
      .replace(/\t/g, ' ')
      .split('\n')
      .map((line) => line.trim())
      .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))
      .map((line) => {
        let current = line;
        current = current.replace(/^#+\s*/g, '');
        current = current.replace(/^[-*]\s+/g, '• ');
        current = current.replace(/\*(.*?)\*/g, '$1');
        current = current.replace(/\s{2,}/g, ' ');
        return current;
      });

    const optionLines = this.convertListLinesToOptions(normalizedLines);

    let output = optionLines.join('\n').trim();

    if (
      (output.startsWith('"') && output.endsWith('"')) ||
      (output.startsWith("'") && output.endsWith("'"))
    ) {
      output = output.slice(1, -1).trim();
    }

    if (!output) {
      output = 'Desculpe, não consegui processar sua solicitação.';
    }

    if (output.length > WHATSAPP_TARGET_LENGTH) {
      output =
        output.slice(0, WHATSAPP_TARGET_LENGTH - 45).trimEnd() +
        '\n\n_Acesse a plataforma para mais detalhes._';
    }

    return output;
  }

  private convertListLinesToOptions(lines: string[]): string[] {
    const result: string[] = [];
    let index = 0;

    while (index < lines.length) {
      if (!this.isListLine(lines[index])) {
        result.push(lines[index]);
        index += 1;
        continue;
      }

      const blockItems: string[] = [];
      while (index < lines.length && this.isListLine(lines[index])) {
        const item = this.extractListLineContent(lines[index]);
        if (item) blockItems.push(item);
        index += 1;
      }

      blockItems.forEach((item, idx) => {
        result.push(`${idx + 1} - ${item}`);
      });
    }

    return result;
  }

  private isListLine(line: string): boolean {
    if (!line) return false;
    return /^(?:•\s+|\d{1,2}[\)\.-]\s+)/.test(line);
  }

  private extractListLineContent(line: string): string {
    return line
      .replace(/^•\s+/, '')
      .replace(/^\d{1,2}[\)\.-]\s+/, '')
      .trim();
  }

  private normalizeInboundPhone(rawFrom: string): {
    canonicalPhone: string;
    lookupCandidates: string[];
  } {
    const withoutPrefix = (rawFrom || '').replace(/^whatsapp:/i, '').trim();
    const digits = withoutPrefix.replace(/\D/g, '');

    if (!digits) {
      return {
        canonicalPhone: withoutPrefix,
        lookupCandidates: [withoutPrefix].filter(Boolean),
      };
    }

    const withCountry = digits.startsWith('55') ? digits : `55${digits}`;
    const localWithoutCountry =
      withCountry.startsWith('55') && withCountry.length > 11
        ? withCountry.slice(2)
        : withCountry;

    const canonicalPhone = `+${withCountry}`;
    const formattedCandidates = this.buildPhoneLookupVariants(
      withCountry,
      localWithoutCountry,
    );

    const lookupCandidates = [
      canonicalPhone,
      withCountry,
      localWithoutCountry,
      withoutPrefix,
      ...formattedCandidates,
    ].filter(
      (value, index, arr) => Boolean(value) && arr.indexOf(value) === index,
    );

    return { canonicalPhone, lookupCandidates };
  }

  private async findUserByPhoneCandidates(
    primaryPhone: string,
    candidates: string[],
  ): Promise<User | null> {
    for (const candidate of candidates) {
      const user = await this.userRepository.findOneByPhone(candidate);
      if (user) return user;
    }

    if (!candidates.includes(primaryPhone)) {
      return this.userRepository.findOneByPhone(primaryPhone);
    }

    return null;
  }

  private normalizeIntentText(value: string): string {
    return (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isClearContextCommand(normalizedInput: string): boolean {
    if (!normalizedInput) return false;
    if (CLEAR_CONTEXT_EXACT_COMMANDS.has(normalizedInput)) return true;

    return (
      normalizedInput.startsWith('limpar contexto') ||
      normalizedInput.startsWith('limpar conversa') ||
      normalizedInput.startsWith('limpar historico') ||
      normalizedInput.startsWith('limpar chat') ||
      normalizedInput.startsWith('apagar contexto') ||
      normalizedInput.startsWith('apagar historico') ||
      normalizedInput.startsWith('resetar contexto') ||
      normalizedInput.startsWith('resetar conversa')
    );
  }

  private getPendingClearContext(
    phone: string,
  ): PendingClearContextConfirmation | null {
    const pending = this.pendingClearContextByPhone.get(phone);
    if (!pending) return null;

    if (Date.now() > pending.expiresAt) {
      this.pendingClearContextByPhone.delete(phone);
      return null;
    }

    return pending;
  }

  private isConfirmationInput(normalizedInput: string): boolean {
    return (
      normalizedInput === 'sim' ||
      normalizedInput === 'confirmo' ||
      normalizedInput === 'confirmar' ||
      normalizedInput === 'pode limpar' ||
      normalizedInput === 'limpar'
    );
  }

  private isCancelConfirmationInput(normalizedInput: string): boolean {
    return (
      normalizedInput === 'nao' ||
      normalizedInput === 'não' ||
      normalizedInput === 'cancelar' ||
      normalizedInput === 'cancela' ||
      normalizedInput === 'deixa assim' ||
      normalizedInput === 'nao limpar' ||
      normalizedInput === 'não limpar'
    );
  }

  private buildPhoneLookupVariants(
    withCountry: string,
    localWithoutCountry: string,
  ): string[] {
    const variants: string[] = [];

    const localDigits = (localWithoutCountry || '').replace(/\D/g, '');
    const localOptions = this.expandBrazilianLocalVariants(localDigits);

    for (const digits of localOptions) {
      if (digits.length === 11) {
        const ddd = digits.slice(0, 2);
        const first = digits.slice(2, 7);
        const last = digits.slice(7);
        variants.push(`(${ddd}) ${first}-${last}`);
        variants.push(`${ddd} ${first}-${last}`);
        variants.push(`${ddd}${first}-${last}`);
      }

      if (digits.length === 10) {
        const ddd = digits.slice(0, 2);
        const first = digits.slice(2, 6);
        const last = digits.slice(6);
        variants.push(`(${ddd}) ${first}-${last}`);
        variants.push(`${ddd} ${first}-${last}`);
        variants.push(`${ddd}${first}-${last}`);
      }

      variants.push(`+55${digits}`);
      variants.push(`55${digits}`);
      variants.push(digits);
    }

    return variants.filter(Boolean);
  }

  private expandBrazilianLocalVariants(localDigits: string): string[] {
    const variants = new Set<string>();
    if (!localDigits) return [];

    variants.add(localDigits);

    // Ex.: 31 8908-5791 -> 31 9 8908-5791
    if (localDigits.length === 10) {
      variants.add(`${localDigits.slice(0, 2)}9${localDigits.slice(2)}`);
    }

    // Ex.: 31 9 8908-5791 -> 31 8908-5791
    if (localDigits.length === 11 && localDigits[2] === '9') {
      variants.add(`${localDigits.slice(0, 2)}${localDigits.slice(3)}`);
    }

    return Array.from(variants);
  }

  private isSuccessfulMutationResult(output: string): boolean {
    const text = (output || '').toLowerCase();
    if (!text.trim()) return false;

    const hasFailureSignal =
      text.includes('erro') ||
      text.includes('inválid') ||
      text.includes('não encontrada') ||
      text.includes('nao encontrada') ||
      text.includes('permissão') ||
      text.includes('acesso negado') ||
      text.includes('confirme com "sim"') ||
      text.includes('deseja confirmar');

    if (hasFailureSignal) return false;

    return (
      text.includes('sucesso') ||
      text.includes('criada') ||
      text.includes('atualizada') ||
      text.includes('confirmad') ||
      text.includes('registrad') ||
      text.includes('avançad') ||
      text.includes('marcada')
    );
  }

  private mapPendencyToAction(key: string): {
    action: string;
    minParams: string[];
  } {
    switch (key) {
      case 'patient_data':
        return {
          action: 'update_patient_data',
          minParams: ['surgery_request_id', 'name|cpf|phone|birth_date'],
        };
      case 'hospital_data':
        return {
          action: 'set_hospital',
          minParams: ['surgery_request_id', 'hospital_name'],
        };
      case 'tuss_procedures':
        return {
          action: 'add_tuss_item',
          minParams: ['surgery_request_id', 'tuss_code', 'name'],
        };
      case 'opme_items':
        return {
          action: 'set_has_opme ou add_opme_item',
          minParams: ['surgery_request_id', 'has_opme=true|false'],
        };
      case 'medical_report':
        return {
          action: 'manage_report_sections',
          minParams: ['surgery_request_id', 'operation=create', 'title'],
        };
      case 'schedule_dates':
        return {
          action: 'update_date_options',
          minParams: ['surgery_request_id', 'date_options[]'],
        };
      case 'confirm_date':
        return {
          action: 'confirm_date',
          minParams: ['surgery_request_id', 'selected_date_index'],
        };
      case 'confirm_receipt':
        return {
          action: 'confirm_receipt',
          minParams: ['surgery_request_id', 'received_value', 'received_at'],
        };
      default:
        if (key.startsWith('doc_')) {
          return {
            action: 'attach_document_from_whatsapp',
            minParams: ['surgery_request_id', 'document_type?', 'confirm=true'],
          };
        }
        return {
          action: 'get_pendencies',
          minParams: ['surgery_request_id'],
        };
    }
  }

  private async appendNextStepIfNeeded(
    toolName: string,
    args: Record<string, any>,
    toolOutput: string,
    context: ToolContext,
  ): Promise<string> {
    if (!MUTATION_TOOL_NAMES.has(toolName)) return toolOutput;
    if (args.confirm !== true) return toolOutput;
    if (!this.isSuccessfulMutationResult(toolOutput)) return toolOutput;

    const requestId =
      typeof args.surgery_request_id === 'string'
        ? args.surgery_request_id
        : typeof args.id === 'string'
          ? args.id
          : '';

    if (!requestId) return toolOutput;

    try {
      const request = await this.surgeryRequestRepo.findOneSimple({
        id: requestId,
      });
      if (!request) return toolOutput;
      if (!context.accessibleDoctorIds.includes(request.doctor_id)) {
        return toolOutput;
      }

      const validation =
        await this.pendencyValidator.validateForStatus(requestId);
      const pending = validation.pendencies.filter(
        (item) => !item.isComplete && !item.isOptional,
      );

      if (!pending.length) {
        return `${toolOutput}\n\nPróximo passo recomendado:\nA solicitação está sem pendências bloqueantes. Posso executar advance_surgery_request com confirm=true.`;
      }

      const next = pending[0];
      const recommendation = this.mapPendencyToAction(next.key);
      return `${toolOutput}\n\nPróximo passo recomendado:\nPendência atual: ${next.name}.\nAção recomendada: ${recommendation.action}.\nParâmetros mínimos: ${recommendation.minParams.join(', ')}.\nDeseja que eu execute essa ação agora?`;
    } catch {
      return toolOutput;
    }
  }
}
