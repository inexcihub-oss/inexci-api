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
 *  │   • headers/        → logo do cabeçalho customizado do médico  │
 *  └────────────────────────────────────────────────────────────────┘
 *
 * Regra: use STORAGE_BUCKET para o nome do bucket e STORAGE_FOLDERS
 * para a pasta dentro dele. Nunca escreva strings literais no código.
 */

import { registerAs } from '@nestjs/config';

// ── Config registrada via ConfigService ──────────────────────────────────────

export const storageConfig = registerAs('storage', () => ({
  bucket: process.env.SUPABASE_BUCKET || 'inexci-storage',
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
} as const;
