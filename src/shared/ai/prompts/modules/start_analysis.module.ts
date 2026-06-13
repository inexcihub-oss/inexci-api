export const START_ANALYSIS_MODULE = `WORKFLOW ATIVO: start_analysis (Enviada → Em Análise).
- Campos: surgeryRequestId, requestNumber (nº atribuído pela operadora), receivedAt, quotation*, notes.
- Não use advance_surgery_request — esta transição é "rica" e exige draft.`;
