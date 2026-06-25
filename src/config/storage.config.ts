/**
 * Mapeamento centralizado do bucket e pastas do Cloudflare R2 Storage.
 *
 * ARQUITETURA: 1 bucket privado, acesso exclusivamente via signed URL.
 *
 *  ┌─ R2_BUCKET (bucket PRIVADO) ───────────────────────────────────┐
 *  │   Todos os arquivos requerem autenticação (signed URL).        │
 *  │                                                                 │
 *  │   • avatars/        → fotos de perfil dos usuários             │
 *  │   • documents/      → documentos da solicitação cirúrgica      │
 *  │   • post-surgical/  → laudos e docs pós-cirúrgicos             │
 *  │   • report/         → imagens anexadas ao laudo PDF            │
 *  │   • signatures/     → assinatura digital do médico             │
 *  │   • stamps/         → carimbo do médico                        │
 *  │   • headers/        → logo do cabeçalho customizado do médico  │
 *  └────────────────────────────────────────────────────────────────┘
 *
 * Regra: use STORAGE_BUCKET para o nome do bucket e STORAGE_FOLDERS
 * para a pasta dentro dele. Nunca escreva strings literais no código.
 */

import { registerAs } from '@nestjs/config';

// ── Config registrada via ConfigService ──────────────────────────────────────

export const storageConfig = registerAs('storage', () => ({
  bucket: process.env.R2_BUCKET,
}));

/** Token para acesso direto ao nome do bucket (retrocompatibilidade) */
export const STORAGE_BUCKET_TOKEN = 'STORAGE_BUCKET';

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

  /** Logo do cabeçalho customizado do médico */
  HEADERS: 'headers',

  /**
   * Pasta temporária para mídias inbound do WhatsApp (imagens/PDFs) enquanto
   * o assistente IA aguarda o usuário escolher o que fazer com o arquivo.
   * Limpada periodicamente via cron (ver `AI_DOC_TMP_RETENTION_HOURS`).
   */
  WHATSAPP_TMP: 'whatsapp-tmp',

  /** PDFs gerados automaticamente pelo sistema (laudo, contestação). */
  PDFS: 'pdfs',

  /** PDFs temporários gerados para download imediato via WhatsApp IA. */
  WHATSAPP_DOWNLOADS: 'whatsapp-downloads',
} as const;

// ── TTL das signed URLs por pasta (segundos) ─────────────────────────────────

/**
 * Tempo de expiração das signed URLs diferenciado por sensibilidade dos dados.
 * Dados médicos têm TTL mais curto; imagens não-sensíveis podem ser mais longas.
 */
export const STORAGE_FOLDER_TTL: Record<string, number> = {
  [STORAGE_FOLDERS.DOCUMENTS]: 15 * 60,
  [STORAGE_FOLDERS.POST_SURGICAL]: 15 * 60,
  [STORAGE_FOLDERS.SIGNATURES]: 60 * 60,
  [STORAGE_FOLDERS.STAMPS]: 60 * 60,
  [STORAGE_FOLDERS.REPORT]: 60 * 60,
  [STORAGE_FOLDERS.AVATARS]: 24 * 60 * 60,
  [STORAGE_FOLDERS.HEADERS]: 24 * 60 * 60,
  [STORAGE_FOLDERS.WHATSAPP_TMP]: 10 * 60,
  [STORAGE_FOLDERS.PDFS]: 60 * 60,
  [STORAGE_FOLDERS.WHATSAPP_DOWNLOADS]: 10 * 60,
};

// ── Limites de tamanho por pasta (bytes) ─────────────────────────────────────

/**
 * Limite máximo de tamanho de arquivo por pasta.
 * Aplicado no UploadService antes de enviar ao storage.
 */
export const STORAGE_FOLDER_SIZE_LIMITS: Record<string, number> = {
  [STORAGE_FOLDERS.DOCUMENTS]: 10 * 1024 * 1024,
  [STORAGE_FOLDERS.POST_SURGICAL]: 10 * 1024 * 1024,
  [STORAGE_FOLDERS.WHATSAPP_TMP]: 10 * 1024 * 1024,
  [STORAGE_FOLDERS.REPORT]: 5 * 1024 * 1024,
  [STORAGE_FOLDERS.HEADERS]: 2 * 1024 * 1024,
  [STORAGE_FOLDERS.AVATARS]: 2 * 1024 * 1024,
  [STORAGE_FOLDERS.SIGNATURES]: 500 * 1024,
  [STORAGE_FOLDERS.STAMPS]: 500 * 1024,
  [STORAGE_FOLDERS.PDFS]: 10 * 1024 * 1024,
  [STORAGE_FOLDERS.WHATSAPP_DOWNLOADS]: 10 * 1024 * 1024,
};
