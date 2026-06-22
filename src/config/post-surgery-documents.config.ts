/**
 * Documentos pós-cirúrgicos que podem ser anexados após a realização.
 *
 * Nenhum deles é obrigatório para a transição SCHEDULED → PERFORMED.
 * Eles compõem o pacote final de faturamento quando informados — o frontend
 * orienta isso e a IA do WhatsApp usa esta lista como guia de recomendação.
 */
export interface PostSurgeryRequiredDoc {
  /** Tipo persistido em `documents.type` (ver `common/document-types.common.ts`). */
  type: string;
  /** Rótulo amigável para mostrar ao usuário. */
  label: string;
  /** Se true, bloqueia `mark_performed` quando ausente (hoje todos são opcionais). */
  required: boolean;
  /** Texto curto explicando o que esperar — mostrado no WhatsApp. */
  hint: string;
}

export const POST_SURGERY_REQUIRED_DOCS: PostSurgeryRequiredDoc[] = [
  {
    type: 'surgery_room',
    label: 'Ficha da sala de cirurgia',
    required: false,
    hint: 'Documento da sala/centro cirúrgico contendo registro do procedimento (descrição cirúrgica, equipe, horários).',
  },
  {
    type: 'surgery_auth_document',
    label: 'Documento de autorização da cirurgia',
    required: false,
    hint: 'Cópia da autorização emitida pelo convênio para a cirurgia realizada.',
  },
  {
    type: 'surgery_images',
    label: 'Imagens / fotos da cirurgia',
    required: false,
    hint: 'Fotos do procedimento, peça operatória ou achados intraoperatórios (opcional, mas recomendado).',
  },
];

/** Conjunto de tipos para lookup O(1). */
export const POST_SURGERY_DOC_TYPES: ReadonlySet<string> = new Set(
  POST_SURGERY_REQUIRED_DOCS.map((d) => d.type),
);

export function isPostSurgeryDocType(type: string | null | undefined): boolean {
  if (!type) return false;
  return POST_SURGERY_DOC_TYPES.has(type);
}
