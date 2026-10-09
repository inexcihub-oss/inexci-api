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
  invalidatesOn?: string[];
}

export interface AiTool {
  name: string;
  definition: OpenAI.ChatCompletionTool;
  cacheable?: AiToolCacheConfig;
  bypassesService?: boolean;
  requiredPermission?: Permission | readonly Permission[];
  execute(args: Record<string, any>, context: ToolContext): Promise<string>;
}
