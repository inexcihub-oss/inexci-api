import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import OpenAI from 'openai';
import { OpenaiService } from './openai.service';
import { ConversationService } from './conversation.service';
import { ToolRegistryService } from './tool-registry.service';
import { ToolExecutorService } from './tool-executor.service';
import { RagService } from '../../rag/rag.service';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { UserRepository } from '../../../database/repositories/user.repository';
import { AccessControlService } from '../../services/access-control.service';
import { ToolContext } from '../tools/tool.interface';
import { SYSTEM_PROMPT } from '../prompts/system-prompt';

const MAX_TOOL_ITERATIONS = 5;
const MAX_RESPONSE_LENGTH = 1000;

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
  ) {}

  async enqueueInboundMessage(data: {
    from: string;
    body: string;
    messageSid: string;
    mediaUrl: string | null;
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
  }): Promise<void> {
    const phone = data.from.replace('whatsapp:', '');
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
      const cachedUser = this.userCache.get(phone);
      const user =
        cachedUser ?? (await this.userRepository.findOneByPhone(phone));
      if (user && !cachedUser) this.userCache.set(phone, user, 10 * 60 * 1000); // 10 min

      const userId = user?.id || null;

      if (!userId) {
        await this.handleUnknownUser(phone, data.body);
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

      const completion = await this.openaiService.chatCompletion({
        messages,
        tools,
      });
      let responseMessage = completion.choices[0].message;

      const toolContext: ToolContext = {
        userId,
        phone,
        accessibleDoctorIds,
        conversationId: conversation.id,
      };

      let iterations = MAX_TOOL_ITERATIONS;
      while (responseMessage.tool_calls?.length && iterations > 0) {
        iterations--;

        const toolResults = await this.toolExecutor.executeMany(
          responseMessage.tool_calls,
          toolContext,
        );

        messages.push(responseMessage as OpenAI.ChatCompletionMessageParam);
        for (const result of toolResults) {
          messages.push({
            role: 'tool',
            tool_call_id: result.toolCallId,
            content: result.output,
          });
        }

        const followUp = await this.openaiService.chatCompletion({
          messages,
          tools,
        });
        responseMessage = followUp.choices[0].message;
      }

      let finalText =
        responseMessage.content ||
        'Desculpe, não consegui processar sua solicitação.';

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

      this.logger.log(
        `Resposta enviada para ${phone} (${finalText.length} chars)`,
      );
    } catch (error: any) {
      this.logger.error(
        `Erro ao processar mensagem de ${phone}: ${error.message}`,
        error.stack,
      );
      await this.whatsappService.sendMessage(
        phone,
        '⚠️ Desculpe, estou com dificuldades técnicas no momento. Por favor, tente novamente em alguns minutos ou acesse a plataforma web.',
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
  ): Promise<void> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'system',
        content:
          'ATENÇÃO: Este usuário NÃO está cadastrado no sistema. Responda APENAS perguntas gerais sobre a INEXCI. NÃO use nenhuma ferramenta. Oriente-o a se cadastrar na plataforma web para acessar funcionalidades completas.',
      },
      { role: 'user', content: message },
    ];

    const completion = await this.openaiService.chatCompletion({ messages });
    const text =
      completion.choices[0].message.content ||
      'Olá! Para utilizar nossos serviços, você precisa estar cadastrado na plataforma INEXCI.';

    await this.whatsappService.sendMessage(phone, text);
  }
}
