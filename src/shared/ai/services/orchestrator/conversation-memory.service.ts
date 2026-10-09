import { Injectable, Logger } from '@nestjs/common';
import { In } from 'typeorm';
import { WhatsappConversationRepository } from '../../../../database/repositories/whatsapp-conversation.repository';
import { UserRepository } from '../../../../database/repositories/user.repository';
import { parseToolResult } from '../../tools/tool-result';
import { SimpleCache } from '../../utils/simple-cache';

const DOCTORS_INFO_CACHE_TTL_MS = 5 * 60 * 1000;

export type AwaitingMediaKind = 'signature';

export interface AwaitingMediaState {
  kind: AwaitingMediaKind;
  since: number;
  expiresAt: number;
}

const AWAITING_MEDIA_TTL_MS = 10 * 60 * 1000;

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

  async getAwaitingMedia(
    conversationId: string,
  ): Promise<AwaitingMediaState | null> {
    const memory = await this.readMemory(conversationId);
    const raw = memory?.awaitingMedia as AwaitingMediaState | undefined;
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.expiresAt !== 'number' || raw.expiresAt <= Date.now()) {
      await this.clearAwaitingMedia(conversationId);
      return null;
    }
    return raw;
  }

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
