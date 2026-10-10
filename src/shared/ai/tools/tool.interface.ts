import OpenAI from 'openai';
import { PiiVaultService } from '../services/pii-vault.service';
import { Permission } from 'src/shared/permissions';

export const AI_TOOL = 'AI_TOOL';

export interface ToolContext {
  userId: string | null;
  phone: string;
  accessibleDoctorIds: string[];
  conversationId: string;
  ownerId?: string | null;
  inboundMedia?: Array<{
    url: string;
    contentType?: string | null;
  }>;
  piiVault?: PiiVaultService;
  permissions?: Permission[];
}

export interface AiToolCacheConfig {
  ttlSeconds: number;
}

export const ANY_AUTHENTICATED = 'any_authenticated' as const;

export type ToolPermissionRequirement =
  | Permission
  | readonly Permission[]
  | typeof ANY_AUTHENTICATED;

export interface AiTool {
  name: string;
  definition: OpenAI.ChatCompletionTool;
  cacheable?: AiToolCacheConfig;
  requiredPermission: ToolPermissionRequirement;
  mutates?: boolean;
  execute(args: Record<string, any>, context: ToolContext): Promise<string>;
}
