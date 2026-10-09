export enum Permission {
  AGENDA = 'agenda',
  ATENDIMENTO = 'atendimento',
  SOLICITACOES = 'solicitacoes',
  ADMINISTRACAO = 'administracao',
}

export const ALL_PERMISSIONS: readonly Permission[] = [
  Permission.AGENDA,
  Permission.ATENDIMENTO,
  Permission.SOLICITACOES,
  Permission.ADMINISTRACAO,
];
