export interface PostSurgeryRequiredDoc {
  type: string;
  label: string;
  required: boolean;
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

export const POST_SURGERY_DOC_TYPES: ReadonlySet<string> = new Set(
  POST_SURGERY_REQUIRED_DOCS.map((d) => d.type),
);

export function isPostSurgeryDocType(type: string | null | undefined): boolean {
  if (!type) return false;
  return POST_SURGERY_DOC_TYPES.has(type);
}
