/**
 * Re-export do builder de tools do fluxo WhatsApp.
 *
 * A implementação foi extraída para `./whatsapp-flow/`, com um arquivo
 * `*.tool.ts` por tool (Fase 2 do `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`).
 */
export { buildWhatsappFlowTools } from './whatsapp-flow/index';
export type { WhatsappFlowDocumentDeps as WhatsappFlowToolDeps } from './whatsapp-flow/_types';
