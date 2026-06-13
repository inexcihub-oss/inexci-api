export const SEND_SC_MODULE = `WORKFLOW ATIVO: send_sc (Pendente → Enviada).
- Pré-requisitos: paciente completo, hospital, ≥1 TUSS, OPME (≥1 cadastrado OU set_has_opme(false)), laudo com ≥1 seção e assinatura configurada.
- Métodos válidos (campo \`method\`): apenas "email" ou "download". Quando perguntar, ofereça "1 - E-mail" e "2 - Download". NÃO invente "correio", "pessoalmente".
- E-mail: \`to\` e \`subject\` obrigatórios; \`message\` opcional. Anexos extras opcionais via manage_documents → draft_update(attachments).
- Download: após commit, repasse a signed URL devolvida pela tool (válida 1h).
- Não chame advance_surgery_request para 1→2 — use sempre send_sc_draft_*.`;
