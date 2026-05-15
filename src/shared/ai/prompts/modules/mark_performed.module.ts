export const MARK_PERFORMED_MODULE = `WORKFLOW ATIVO: mark_performed (Agendada → Realizada).
- Campos: surgeryRequestId, surgeryPerformedAt.
- OBRIGATÓRIO: chame mark_performed_draft_check_docs antes do preview/commit. surgery_room (folha de sala) e surgery_auth_document (autorização) precisam estar anexados; surgery_images é opcional.
- Se faltar documento, peça envio pelo WhatsApp ou pela plataforma.`;
