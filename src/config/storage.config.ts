/**
 * Mapeamento centralizado do bucket e pastas do Supabase Storage.
 *
 * ARQUITETURA: 1 bucket privado, acesso exclusivamente via signed URL.
 *
 *  ┌─ inexci-storage (bucket PRIVADO) ──────────────────────────────┐
 *  │   Todos os arquivos requerem autenticação (signed URL, 1h).    │
 *  │                                                                 │
 *  │   • avatars/        → fotos de perfil dos usuários             │
 *  │   • documents/      → documentos da solicitação cirúrgica      │
 *  │   • post-surgical/  → laudos e docs pós-cirúrgicos             │ *  │   • report/         → imagens anexadas ao laudo PDF             │ *  │   • signatures/     → assinatura digital do médico             │
 *  │   • stamps/         → carimbo do médico                        │
 *  └────────────────────────────────────────────────────────────────┘
 *
 * Regra: use STORAGE_BUCKET para o nome do bucket e STORAGE_FOLDERS
 * para a pasta dentro dele. Nunca escreva strings literais no código.
 */

// ── Bucket ────────────────────────────────────────────────────────────────────

export const STORAGE_BUCKET = process.env.SUPABASE_BUCKET || 'inexci-storage';

// ── Pastas ────────────────────────────────────────────────────────────────────

export const STORAGE_FOLDERS = {
  /** Fotos de perfil dos usuários */
  AVATARS: 'avatars',

  /** Documentos vinculados à solicitação cirúrgica (pré-operatório) */
  DOCUMENTS: 'documents',

  /** Laudos e documentos enviados após a cirurgia */
  POST_SURGICAL: 'post-surgical',

  /** Imagens anexadas ao laudo PDF */
  REPORT: 'report',

  /** Assinatura digital do médico (usada no PDF) */
  SIGNATURES: 'signatures',

  /** Carimbo do médico (usado no PDF) */
  STAMPS: 'stamps',
} as const;
