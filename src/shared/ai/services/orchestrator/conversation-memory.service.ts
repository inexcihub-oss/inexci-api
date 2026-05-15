import { Injectable, Logger } from '@nestjs/common';
import { In } from 'typeorm';
import { WhatsappConversationRepository } from '../../../../database/repositories/whatsapp-conversation.repository';
import { UserRepository } from '../../../../database/repositories/user.repository';
import { parseToolResult } from '../../tools/tool-result';
import { SimpleCache } from '../../utils/simple-cache';

const DOCTORS_INFO_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

/** Tipos de mídia que o orchestrator pode estar "esperando" do usuário. */
export type AwaitingMediaKind = 'signature';

/**
 * Estado estruturado de "expectativa de mídia": dizemos explicitamente que
 * estamos esperando a próxima imagem/PDF do usuário ser de um certo tipo
 * (ex.: a foto da assinatura digital do médico após ele escolher a opção
 * "Enviar foto da assinatura"). Substitui detecção por regex/texto solto.
 *
 * `expiresAt` em ms epoch — quando ultrapassa, ignoramos a expectativa.
 */
export interface AwaitingMediaState {
  kind: AwaitingMediaKind;
  since: number;
  expiresAt: number;
}

/** Default: 10 min para o usuário enviar a mídia após declarar a intenção. */
const AWAITING_MEDIA_TTL_MS = 10 * 60 * 1000;

/**
 * Gerencia a memória persistida de cada conversa WhatsApp
 * (`conversationMemory` JSONB) e o cache de informações dos médicos
 * acessíveis ao usuário para enriquecimento do contexto da IA.
 *
 * Extraído do `AiOrchestratorService` na Fase 2 do
 * `PLANO-REDUCAO-ORCHESTRATOR-FASE2.md`.
 */
@Injectable()
export class ConversationMemoryService {
  private readonly logger = new Logger(ConversationMemoryService.name);
  private readonly accessibleDoctorsInfoCache = new SimpleCache<
    Array<{ id: string; name?: string | null }>
  >();

  constructor(
    private readonly whatsappConversationRepo: WhatsappConversationRepository,
    private readonly userRepository: UserRepository,
  ) {}

  /**
   * Lê do banco a memória mais recente da conversa (cobre escritas feitas
   * em turnos anteriores que ainda não estão no objeto carregado na
   * variável local).
   */
  async readMemory(
    conversationId: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const conv = await this.whatsappConversationRepo.findOne({
        id: conversationId,
      } as any);
      return (conv?.conversationMemory as Record<string, unknown>) || null;
    } catch (err) {
      this.logger.debug(
        `[PENDING_CONFIRMATION] read_failed conv=${conversationId} err=${(err as Error)?.message}`,
      );
      return null;
    }
  }

  /**
   * Aplica um patch incremental à `conversationMemory` JSONB sem
   * sobrescrever campos existentes. Silencia falhas — memória é best-effort.
   */
  async patchMemory(
    conversationId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    try {
      const conv = await this.whatsappConversationRepo.findOne({
        id: conversationId,
      } as any);
      if (!conv) return;
      const memory = (conv.conversationMemory as Record<string, unknown>) || {};
      await this.whatsappConversationRepo.update(conversationId, {
        conversationMemory: { ...memory, ...patch } as any,
      });
    } catch (err) {
      this.logger.debug(
        `[PENDING_CONFIRMATION] write_failed conv=${conversationId} err=${(err as Error)?.message}`,
      );
    }
  }

  /**
   * Memoriza entidades em `conversationMemory.filled_slots` /
   * `surgeryRequest` para o system prompt do próximo turno injetar no
   * bloco "SC EM CONSTRUÇÃO" e o LLM não voltar a perguntar a mesma
   * coisa. O gate é o envelope canônico (`status !== 'ok'` não memoriza).
   */
  async memorizeEntities(opts: {
    conversationId: string;
    toolName: string;
    args: Record<string, any>;
    output: string;
  }): Promise<void> {
    const { conversationId, toolName, args, output } = opts;

    const parsed = parseToolResult(output);
    if (parsed && parsed.status !== 'ok') return;

    const memory = (await this.readMemory(conversationId)) || {};
    const filled: Record<string, unknown> = {
      ...((memory as any).filled_slots || {}),
    };
    const surgeryRequest: Record<string, unknown> = {
      ...((memory as any).surgeryRequest || {}),
    };

    const setIfPresent = (
      target: Record<string, unknown>,
      key: string,
      value: unknown,
    ) => {
      if (value === null || value === undefined) return;
      const text = String(value).trim();
      if (!text) return;
      target[key] = text;
    };

    switch (toolName) {
      case 'set_hospital':
        setIfPresent(
          surgeryRequest,
          'hospital',
          args.hospitalId || args.hospital_name,
        );
        break;
      case 'set_health_plan':
        setIfPresent(
          surgeryRequest,
          'healthPlan',
          args.healthPlanId || args.health_plan_name,
        );
        break;
      case 'upload_doctor_signature':
        // Upload de assinatura concluído com sucesso → limpa a expectativa
        // de mídia (caso o orchestrator a tenha marcado quando o usuário
        // escolheu "1 - Enviar foto da assinatura digital").
        if (args.confirm === true) {
          await this.clearAwaitingMedia(conversationId);
        }
        return;
      default:
        return;
    }

    await this.patchMemory(conversationId, {
      filled_slots: filled,
      surgeryRequest,
    });
  }

  /**
   * Marca que o orchestrator está aguardando o próximo upload do usuário
   * para um tipo específico (ex.: assinatura digital). Esse estado evita
   * que o pipeline genérico de documento (com prompt "1=anexar / 2=criar
   * SC / 3=cadastrar paciente") interfira quando o usuário acabou de
   * declarar "vou mandar minha assinatura".
   */
  async setAwaitingMedia(
    conversationId: string,
    kind: AwaitingMediaKind,
    ttlMs: number = AWAITING_MEDIA_TTL_MS,
  ): Promise<void> {
    const now = Date.now();
    await this.patchMemory(conversationId, {
      awaitingMedia: {
        kind,
        since: now,
        expiresAt: now + ttlMs,
      } satisfies AwaitingMediaState,
    });
  }

  /**
   * Lê o estado de expectativa de mídia. Retorna `null` quando não há
   * expectativa registrada OU quando ela já expirou (também limpa a flag
   * expirada para manter a memória enxuta).
   */
  async getAwaitingMedia(
    conversationId: string,
  ): Promise<AwaitingMediaState | null> {
    const memory = await this.readMemory(conversationId);
    const raw = memory?.awaitingMedia as AwaitingMediaState | undefined;
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.expiresAt !== 'number' || raw.expiresAt <= Date.now()) {
      // Best-effort cleanup; falha silenciosamente se update der erro.
      await this.clearAwaitingMedia(conversationId);
      return null;
    }
    return raw;
  }

  /**
   * Remove a expectativa de mídia (após upload bem-sucedido, cancelamento
   * explícito ou expiração).
   */
  async clearAwaitingMedia(conversationId: string): Promise<void> {
    try {
      const conv = await this.whatsappConversationRepo.findOne({
        id: conversationId,
      } as any);
      if (!conv) return;
      const memory = {
        ...((conv.conversationMemory as Record<string, unknown>) || {}),
      };
      if (!('awaitingMedia' in memory)) return;
      delete (memory as Record<string, unknown>).awaitingMedia;
      await this.whatsappConversationRepo.update(conversationId, {
        conversationMemory: memory as any,
      });
    } catch (err) {
      this.logger.debug(
        `[AWAITING_MEDIA] clear_failed conv=${conversationId} err=${(err as Error)?.message}`,
      );
    }
  }

  /**
   * Resolve a lista de médicos acessíveis ao usuário em `{id, name}` —
   * usado para enriquecer o bloco "USUÁRIO ATUAL" no contexto da IA. Cache
   * curto (5 min) para evitar consulta a cada mensagem.
   */
  async resolveDoctorsInfo(
    accessibleDoctorIds: string[],
  ): Promise<Array<{ id: string; name?: string | null }>> {
    if (!accessibleDoctorIds.length) return [];
    const cacheKey = accessibleDoctorIds.slice().sort().join(',');
    const cached = this.accessibleDoctorsInfoCache.get(cacheKey);
    if (cached) return cached;
    try {
      const doctors = await this.userRepository.findMany(
        { id: In(accessibleDoctorIds) } as any,
        0,
        accessibleDoctorIds.length,
      );
      const info = doctors.map((d: any) => ({
        id: d.id,
        name: d.name ?? null,
      }));
      this.accessibleDoctorsInfoCache.set(
        cacheKey,
        info,
        DOCTORS_INFO_CACHE_TTL_MS,
      );
      return info;
    } catch (err) {
      this.logger.debug(
        `[USER_CONTEXT] failed_to_resolve_doctors err=${(err as Error)?.message}`,
      );
      return accessibleDoctorIds.map((id) => ({ id, name: null }));
    }
  }
}
