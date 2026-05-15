export const MULTIMODAL_DOC_REVIEW_MODULE = `DOCUMENTO PENDENTE.
- Há um documento (PDF/imagem) processado por OCR aguardando intent. Veja OPERATIONAL_STATE.multimodal_context.doc_pending.
- Tools disponíveis: attach_document_from_whatsapp, create_patient_from_document, ou abrir create_sc (plan_actions) reaproveitando os campos extraídos.
- Não invente conteúdo: use somente os campos em OPERATIONAL_STATE.multimodal_context.doc_pending.extracted_summary e os adicionais via tools de lookup quando necessário.`;
