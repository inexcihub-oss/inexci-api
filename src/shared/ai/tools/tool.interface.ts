import OpenAI from 'openai';
import { PiiVaultService } from '../services/pii-vault.service';

export interface ToolContext {
  userId: string | null;
  phone: string;
  accessibleDoctorIds: string[];
  conversationId: string;
  /**
   * ID do admin dono da clínica (tenant). Usado por tools que criam/listam
   * recursos compartilhados pela clínica (hospitais, convênios, etc.).
   * Quando ausente, as tools devem buscar pelo `userId`.
   */
  ownerId?: string | null;
  inboundMedia?: Array<{
    url: string;
    contentType?: string | null;
  }>;
  /**
   * Vault de PII por sessão (presente em produção; ausente em alguns testes legados).
   * Tools devem usá-lo para tokenizar dados sensíveis antes de devolvê-los à IA.
   */
  piiVault?: PiiVaultService;
}

export interface AiTool {
  name: string;
  definition: OpenAI.ChatCompletionTool;
  execute(args: Record<string, any>, context: ToolContext): Promise<string>;
}
