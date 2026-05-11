/**
 * Documentos esperados após uma cirurgia ser realizada.
 *
 * Hoje o backend não BLOQUEIA `mark_performed` na ausência destes
 * documentos (a validação rígida fica no `surgery-request-state-machine`,
 * que só checa transição de status). Mas o fluxo operacional da clínica
 * espera que a SC tenha esse pacote anexado antes de seguir para faturamento
 * — o frontend orienta isso e a IA do WhatsApp passou a usar esta lista
 * como guia para as recomendações pré `mark_performed`.
 *
 * Evolução natural: passar essa lista a uma pendência declarativa em
 * `pendencies.config.ts` (status SCHEDULED) — quando isso acontecer, esse
 * arquivo continua sendo a única fonte de verdade.
 */
export interface PostSurgeryRequiredDoc {
  /** Tipo persistido em `documents.type` (ver `common/document-types.common.ts`). */
  type: string;
  /** Rótulo amigável para mostrar ao usuário. */
  label: string;
  /** Se true, é considerado obrigatório para a SC ser marcada como Realizada. */
  required: boolean;
  /** Texto curto explicando o que esperar — mostrado no WhatsApp. */
  hint: string;
}

export const POST_SURGERY_REQUIRED_DOCS: PostSurgeryRequiredDoc[] = [
  {
    type: 'surgery_room',
    label: 'Ficha da sala de cirurgia',
    required: true,
    hint: 'Documento da sala/centro cirúrgico contendo registro do procedimento (descrição cirúrgica, equipe, horários).',
  },
  {
    type: 'surgery_auth_document',
    label: 'Documento de autorização da cirurgia',
    required: true,
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
