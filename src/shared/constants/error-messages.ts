/**
 * Mensagens de erro padronizadas para toda a aplicação.
 * Utilize estas constantes nos services em vez de strings literais.
 */
export const ERROR_MESSAGES = {
  // Entidades genéricas
  USER_NOT_FOUND: 'Usuário não encontrado',
  SURGERY_REQUEST_NOT_FOUND: 'Solicitação não encontrada',
  PATIENT_NOT_FOUND: 'Paciente não encontrado',
  COLLABORATOR_NOT_FOUND: 'Colaborador não encontrado',
  HOSPITAL_NOT_FOUND: 'Hospital não encontrado',
  SUPPLIER_NOT_FOUND: 'Fornecedor não encontrado',
  DOCTOR_PROFILE_NOT_FOUND: 'Perfil de médico não encontrado',
  DOCUMENT_NOT_FOUND: 'Documento não encontrado',
  OPME_ITEM_NOT_FOUND: 'Item OPME não encontrado',
  QUOTATION_NOT_FOUND: 'Cotação não encontrada',
  REPORT_SECTION_NOT_FOUND: 'Seção não encontrada',
  TEMPLATE_NOT_FOUND: 'Template não encontrado ou sem permissão.',
  BILLING_NOT_FOUND: 'Dados de faturamento não encontrados.',

  // Acesso e permissões
  NO_PERMISSION: 'Sem permissão para realizar esta ação',
  NO_PERMISSION_VIEW_USER: 'Sem permissão para ver este usuário',
  NO_PERMISSION_UPDATE_USER: 'Sem permissão para atualizar este usuário',
  NO_PERMISSION_UPDATE_PROFILE: 'Sem permissão para atualizar este perfil',
  COLLABORATOR_WRONG_ACCOUNT: 'Este colaborador não pertence à sua conta',
  USER_NOT_DOCTOR: 'Este usuário não é médico',
  DOCTOR_PLAN_LIMIT_REACHED: 'Limite de médicos do plano atingido.',
  NO_ACCESSIBLE_DOCTOR: 'Nenhum médico acessível encontrado para este usuário.',

  // Conflitos / validações
  EMAIL_IN_USE: 'E-mail já está em uso',
  PHONE_IN_USE: 'Telefone já está em uso',
  CPF_IN_USE: 'CPF já está em uso',
  INVALID_LINK: 'Link inválido',
  INVALID_PASSWORD: 'Senha atual incorreta',
  ID_REQUIRED: 'ID é obrigatório',
  FILE_REQUIRED: 'Nenhum arquivo foi enviado',

  // Surgery request — fluxo
  INVALID_STATUS: (status: number | string) => `Status inválido: ${status}`,
  INVALID_DATE_INDEX: 'Índice de data inválido.',
  NO_BILLING_DATA: 'Sem dados de faturamento.',
  NO_EMAIL_RECIPIENT: 'Destinatário de e-mail não encontrado.',
  NO_DIVERGENCE_REGISTERED: 'Não há divergência de recebimento registrada.',
  NO_DIVERGENCE_TO_EDIT: 'Não há divergência de recebimento para editar.',
  TUSS_NOT_FOUND: 'Procedimento TUSS não encontrado',

  // Auth
  REFRESH_TOKEN_INVALID: 'Refresh token inválido',
  REFRESH_TOKEN_EXPIRED: 'Refresh token expirado',
} as const;
