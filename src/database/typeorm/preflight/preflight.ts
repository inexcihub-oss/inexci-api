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
  /**
   * Verificações que não puderam rodar porque o schema delas (tabela ou
   * coluna) ainda vai ser criado por uma migration anterior do mesmo deploy.
   * Não bloqueiam: a própria migration roda a mesma checagem antes do DDL.
   */
  adiadas: string[];
  diagnosticos: string[];
}

/**
 * Tabela (42P01) ou coluna (42703) inexistente. Num deploy que leva várias
 * migrations de uma vez, é o esperado para a checagem de uma migration que
 * aperta o schema criado por outra pendente (ex.: índice único numa tabela que
 * a migration anterior cria). Qualquer outro erro continua reprovando.
 */
function ehSchemaAindaNaoCriado(erro: unknown): boolean {
  const e = erro as { code?: string; driverError?: { code?: string } };
  const codigo = e?.code ?? e?.driverError?.code;
  return codigo === '42P01' || codigo === '42703';
}

/**
 * Roda as verificações das migrations ainda pendentes. Fail-closed: qualquer
 * erro de consulta reprova — exceto tabela/coluna que uma migration pendente
 * anterior ainda vai criar (ver `ehSchemaAindaNaoCriado`) —, porque "não consegui verificar" não é "está tudo
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
  const adiadas: string[] = [];
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
      if (ehSchemaAindaNaoCriado(erro)) {
        // Com uma versão da checagem que não depende do schema novo, o
        // dado legado ainda é conferido agora (ex.: consulta sobreposta antes
        // de existir a coluna de encaixe — todas viram "não encaixe").
        if (verificacao.sqlAntesDoSchema) {
          try {
            const conflitos = verificacao.mapear(
              (await deps.consultar(verificacao.sqlAntesDoSchema)) ?? [],
            );
            if (conflitos.length > 0) {
              diagnosticos.push(montarDiagnostico(verificacao, conflitos));
            }
            continue;
          } catch (erroAntes) {
            diagnosticos.push(
              `${verificacao.migration}: falha ao verificar (${(erroAntes as Error).message}). ` +
                'Trate como bloqueio até conseguir consultar o banco.',
            );
            continue;
          }
        }
        adiadas.push(
          `${verificacao.migration}: ${(erro as Error).message} — o schema vem de uma migration pendente; a migration confere o dado antes do DDL.`,
        );
        continue;
      }
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
    adiadas,
    diagnosticos,
  };
}
