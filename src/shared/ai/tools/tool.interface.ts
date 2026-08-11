import OpenAI from 'openai';
import { PiiVaultService } from '../services/pii-vault.service';
import { Permission } from 'src/shared/permissions';

/**
 * Token de injeção multi-provider para coletar o array de todas as tools
 * registradas no `ToolRegistryService`.
 *
 * Fase 6 do `PLANO-SANITIZACAO-CLEAN-CODE-IA.md` — elimina o service locator
 * de 30+ deps no construtor do `ToolRegistryService` substituindo-o por
 * `@Inject(AI_TOOL) allTools: AiTool[]` (Opção B do plano).
 */
export const AI_TOOL = 'AI_TOOL';

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
  /**
   * Permissão efetiva do usuário. O guard HTTP não cobre o WhatsApp, então a
   * checagem acontece no `ToolExecutorService`. Ausente (contexto montado por
   * um caminho legado) é tratado como "nenhuma permissão" — fail-closed.
   */
  permissions?: Permission[];
}

/**
 * Configuração de cache para tools de leitura.
 * Fase 7 do `PLANO-OTIMIZACAO-IA-WHATSAPP-EFICIENCIA.md`.
 */
export interface AiToolCacheConfig {
  /** TTL em segundos para o resultado cacheado. */
  ttlSeconds: number;
  /**
   * Lista de nomes de tools que, ao serem executadas, invalidam o cache
   * desta tool para o mesmo `ownerId`. Útil para listas que mudam após
   * operações de mutação (ex.: `list_sc_creation_catalog` invalida após
   * qualquer `*_draft_commit`).
   */
  invalidatesOn?: string[];
}

export interface AiTool {
  name: string;
  definition: OpenAI.ChatCompletionTool;
  /**
   * Quando presente, o `ToolExecutorService` aplica cache automático ao
   * resultado desta tool. Tools sem este campo nunca são cacheadas.
   * Apenas tools de leitura pura devem declarar `cacheable`.
   */
  cacheable?: AiToolCacheConfig;
  /**
   * Quando `true`, indica que esta tool ainda acessa um repositório diretamente
   * em vez de delegar ao Service correspondente. Usado para telemetria de
   * conformidade arquitetural (meta: 0 tools com `bypassesService=true`).
   * Remover este campo da tool é o critério de "migration concluída".
   */
  bypassesService?: boolean;
  /**
   * Área(s) que a tool exige. Uma lista significa **qualquer uma destas** (OR),
   * igual ao `@RequirePermission(...)` do HTTP — e `ALL_PERMISSIONS` é o
   * equivalente ao `@RequireAnyArea()`: cadastro transversal, que pede ao menos
   * uma área sem amarrar a uma específica.
   *
   * Ausente = qualquer usuário autenticado da conta, **inclusive** o
   * colaborador criado com `permissions: []`. Para tools de mutação isso
   * raramente é o que se quer; prefira `ALL_PERMISSIONS`.
   *
   * Checado pelo `ToolExecutorService` contra `context.permissions`.
   */
  requiredPermission?: Permission | readonly Permission[];
  execute(args: Record<string, any>, context: ToolContext): Promise<string>;
}
