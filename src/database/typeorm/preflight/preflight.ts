import {
  VERIFICACOES_PRE_MIGRATION,
  VerificacaoPreMigration,
  montarDiagnostico,
  verificar,
} from './data-checks';

export interface PreflightDeps {
  aplicadas(): Promise<string[]>;
  consultar(sql: string): Promise<Record<string, unknown>[]>;
  verificacoes?: VerificacaoPreMigration[];
}

export interface ResultadoPreflight {
  aprovado: boolean;
  puladas: string[];
  verificadas: string[];
  adiadas: string[];
  diagnosticos: string[];
}

function ehSchemaAindaNaoCriado(erro: unknown): boolean {
  const e = erro as { code?: string; driverError?: { code?: string } };
  const codigo = e?.code ?? e?.driverError?.code;
  return codigo === '42P01' || codigo === '42703';
}

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
