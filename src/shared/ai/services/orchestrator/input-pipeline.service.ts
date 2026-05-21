import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappService } from '../../../whatsapp/whatsapp.service';
import { WhatsappMediaService } from '../../../whatsapp/whatsapp-media.service';
import { PiiVaultService } from '../pii-vault.service';
import { ConversationService } from '../conversation.service';
import { ClearContextDetectorService } from './clear-context-detector.service';
import { DocumentIntakeService } from './document-intake.service';
import { AudioIntakeService } from './audio-intake.service';
import { AudioPipelineService } from '../architecture/audio-pipeline.service';
import { InboundMessageData } from './message-processor.service';
import { WhatsappConversation } from '../../../../database/entities/whatsapp-conversation.entity';

export type InputPipelineOutcome =
  | { handled: true }
  | {
      handled: false;
      userInputForAi: string;
      userInputRaw: string;
      effectiveBody: string;
      transcriptionContext: any | null;
      semanticInput: any;
      audioCompression: any | null;
      userSource: string;
      normalizedInput: string;
    };

/**
 * Processa o input inbound antes da chamada ao LLM:
 * 1. Clear-context detection (reset de histórico).
 * 2. Document intake (imagens/PDFs via WhatsApp).
 * 3. Audio intake + transcrição.
 * 4. Pré-processamento PII (tokenização antes de enviar à OpenAI).
 * 5. Persistência da mensagem do usuário no histórico.
 *
 * Retorna `{ handled: true }` quando a mensagem foi consumida por um dos
 * handlers acima e o orchestrator deve encerrar sem chamar o LLM.
 *
 * Extraído de `AiOrchestratorService` para reduzir o tamanho do
 * coordenador principal.
 */
@Injectable()
export class InputPipelineService {
  private readonly logger = new Logger(InputPipelineService.name);

  constructor(
    private readonly clearContextDetector: ClearContextDetectorService,
    private readonly documentIntakeService: DocumentIntakeService,
    private readonly audioIntakeService: AudioIntakeService,
    private readonly piiVault: PiiVaultService,
    private readonly conversationService: ConversationService,
    private readonly whatsappService: WhatsappService,
    private readonly whatsappMediaService: WhatsappMediaService,
    private readonly configService: ConfigService,
    @Optional() private readonly audioPipeline?: AudioPipelineService,
  ) {}

  private isFeatureEnabled(key: string, defaultValue = true): boolean {
    const raw = String(
      this.configService.get<string>(key, defaultValue ? 'true' : 'false'),
    )
      .trim()
      .toLowerCase();
    return raw === 'true' || raw === '1';
  }

  async process(
    data: InboundMessageData,
    phone: string,
    conversation: WhatsappConversation,
    userId: string,
    ownerId: string | null,
  ): Promise<InputPipelineOutcome> {
    const normalizedInput = this.clearContextDetector.normalizeText(data.body);

    // --- Clear context detection ---
    const clearOutcome = this.clearContextDetector.tryHandleClearContext(
      phone,
      normalizedInput,
      conversation.id,
    );
    if (clearOutcome.status === 'prompt') {
      await this.whatsappService.sendMessage(phone, clearOutcome.message);
      return { handled: true };
    }

    const confirmationOutcome =
      this.clearContextDetector.tryHandleClearContextConfirmation(
        phone,
        normalizedInput,
      );
    if (confirmationOutcome.status === 'confirmed') {
      await this.conversationService.resetConversationHistory(
        confirmationOutcome.conversationId,
      );
      await this.whatsappService.sendMessage(phone, confirmationOutcome.message);
      return { handled: true };
    }
    if (
      confirmationOutcome.status === 'cancelled' ||
      confirmationOutcome.status === 'reprompt'
    ) {
      await this.whatsappService.sendMessage(phone, confirmationOutcome.message);
      return { handled: true };
    }

    // --- Document intake ---
    const docIntakeResult =
      await this.documentIntakeService.processInboundDocumentIfNeeded({
        phone,
        body: data.body || '',
        normalizedInput,
        messageSid: data.messageSid,
        media: data.media,
        userId,
        ownerId,
        conversationId: conversation.id,
      });
    if (docIntakeResult.handled) return { handled: true };
    const effectiveBody = docIntakeResult.syntheticBody ?? data.body;

    // --- Audio ack ---
    const hasInboundAudio =
      this.audioIntakeService.isAudioEnabled() &&
      (data.media || []).some(
        (item) =>
          item.category === 'audio' ||
          this.whatsappMediaService.isAudioMime(item.contentType),
      );
    if (hasInboundAudio) {
      await this.whatsappService.sendMessage(
        phone,
        '🎧 Recebi seu áudio. Estou analisando e já te respondo.',
      );
    }

    // --- Audio processing ---
    const audioProcessing =
      await this.audioIntakeService.processInboundAudioIfNeeded(data);
    const transcriptionContext = audioProcessing.transcription;

    const useArchPipeline =
      this.audioPipeline &&
      this.isFeatureEnabled('AI_ARCHITECTURE_RUNTIME_ENABLED');

    const audioCompression =
      transcriptionContext && useArchPipeline
        ? this.audioPipeline!.compressTranscription({
            fingerprint: transcriptionContext.fingerprint,
            transcription: transcriptionContext,
          })
        : null;

    const userInputRaw = useArchPipeline
      ? this.audioPipeline!.buildUserInput({
          textInput: effectiveBody || '',
          compression: audioCompression,
        })
      : this.audioIntakeService.buildUserInputForAi({
          textInput: effectiveBody,
          transcriptionText: transcriptionContext?.text || null,
        });

    const semanticInput = useArchPipeline
      ? this.audioPipeline!.toSemanticInput(effectiveBody || '', audioCompression)
      : {
          version: '1.0' as const,
          source: (transcriptionContext ? 'audio' : 'text') as 'audio' | 'text',
          normalizedText: userInputRaw,
          rawText: transcriptionContext?.text || effectiveBody || null,
          entities: [],
          confidence: transcriptionContext?.confidence ?? 0.7,
          missingSegments: [],
          hints: [],
        };

    const hasTypedText = Boolean((effectiveBody || '').trim());
    if (audioProcessing.failed && !hasTypedText) {
      const failureMessage =
        this.audioIntakeService.buildAudioFailureUserMessage(
          audioProcessing.failureReason,
        );
      await this.whatsappService.sendMessage(phone, failureMessage);
      return { handled: true };
    }

    if (!userInputRaw) {
      await this.whatsappService.sendMessage(
        phone,
        'Não consegui identificar texto na sua mensagem. Se preferir, envie novamente em texto ou um áudio mais curto.',
      );
      return { handled: true };
    }

    // --- PII tokenization ---
    const userInputForAi = this.piiVault.preprocessUserInput(
      conversation.id,
      userInputRaw,
    );
    const userSource = this.audioIntakeService.resolveInboundSource(
      effectiveBody,
      transcriptionContext,
    );

    // --- Persist user message (tokenized) ---
    await this.conversationService.appendMessage(
      conversation.id,
      'user',
      userInputForAi,
      undefined,
      {
        source: userSource,
        transcription: transcriptionContext
          ? {
              text: transcriptionContext.text,
              provider: transcriptionContext.provider,
              language: transcriptionContext.language,
              confidence: transcriptionContext.confidence,
              durationSeconds: transcriptionContext.durationSeconds,
              latencyMs: transcriptionContext.latencyMs,
              fallbackUsed: transcriptionContext.fallbackUsed,
            }
          : undefined,
        inboundMedia: (data.media || []).map((item) => ({
          url: item.url,
          contentType: item.contentType,
          category: item.category,
          durationSeconds: item.durationSeconds,
          sizeBytes:
            transcriptionContext?.downloadedMedia?.url === item.url
              ? transcriptionContext.downloadedMedia.sizeBytes
              : undefined,
        })),
      },
    );

    return {
      handled: false,
      userInputForAi,
      userInputRaw,
      effectiveBody,
      transcriptionContext,
      semanticInput,
      audioCompression,
      userSource,
      normalizedInput,
    };
  }
}
