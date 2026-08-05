import {
  VERIFICACOES_PRE_MIGRATION,
  VerificacaoPreMigration,
  montarDiagnostico,
  verificar,
} from './data-checks';

export interface PreflightDeps {
  /** Nomes das migrations já registradas na tabela `migrations`. */
  aplicadas(): Promise<string[]>;
  consultar(sql: string): Promise<Record<string, unknown>[]>;
  verificacoes?: VerificacaoPreMigration[];
}

export interface ResultadoPreflight {
  aprovado: boolean;
  /** Migrations cuja verificação foi pulada por já estarem aplicadas. */
  puladas: string[];
  verificadas: string[];
  diagnosticos: string[];
}

/**
 * Roda as verificações das migrations ainda pendentes. Fail-closed: qualquer
 * erro de consulta reprova, porque "não consegui verificar" não é "está tudo
 * certo" — deixar passar é justamente o que leva o deploy a descobrir o
 * problema com a API já fora do ar.
 */
export async function rodarPreflight(
  deps: PreflightDeps,
): Promise<ResultadoPreflight> {
  const verificacoes = deps.verificacoes ?? VERIFICACOES_PRE_MIGRATION;
  const aplicadas = new Set(await deps.aplicadas());

  const puladas: string[] = [];
  const verificadas: string[] = [];
  const diagnosticos: string[] = [];

  for (const verificacao of verificacoes) {
    if (aplicadas.has(verificacao.migration)) {
      puladas.push(verificacao.migration);
      continue;
    }

    verificadas.push(verificacao.migration);

    try {
      const conflitos = await verificar(verificacao, deps.consultar);
      if (conflitos.length > 0) {
        diagnosticos.push(montarDiagnostico(verificacao, conflitos));
      }
    } catch (erro) {
      diagnosticos.push(
        `${verificacao.migration}: falha ao verificar (${(erro as Error).message}). ` +
          'Trate como bloqueio até conseguir consultar o banco.',
      );
    }
  }

  return {
    aprovado: diagnosticos.length === 0,
    puladas,
    verificadas,
    diagnosticos,
  };
}
