/**
 * Áreas da plataforma que podem ser concedidas a um colaborador.
 *
 * Os valores são gravados em `users.permissions` (text[]) — mudá-los exige
 * migration de dados.
 */
export enum Permission {
  AGENDA = 'agenda',
  ATENDIMENTO = 'atendimento',
  SOLICITACOES = 'solicitacoes',
  ADMINISTRACAO = 'administracao',
}

/**
 * Ordem canônica. `resolveEffectivePermissions` devolve nesta ordem para que o
 * retorno não dependa de como o array foi gravado.
 */
export const ALL_PERMISSIONS: readonly Permission[] = [
  Permission.AGENDA,
  Permission.ATENDIMENTO,
  Permission.SOLICITACOES,
  Permission.ADMINISTRACAO,
];
