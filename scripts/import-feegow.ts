import 'dotenv/config';
import { createInterface } from 'readline/promises';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createR2Client } from '../src/config/r2.config';
import { StorageService } from '../src/shared/storage/storage.service';
import {
  apagarEmLotes,
  ArmazenamentoImportacao,
  comRegistroDeOrfaos,
  limparEPropagar,
} from '../src/database/import/core/armazenamento';
import { assertProcessoEmUtc } from '../src/database/import/core/fuso';
import { dataSourceOptions } from '../src/database/typeorm/data-source';
import { escreverAtomico, Ledger } from '../src/database/import/core/ledger';
import { Relatorio } from '../src/database/import/core/report';
import { ExportFeegow } from '../src/database/import/feegow/export';
import {
  assertBancoPermitido,
  baseDoContexto,
  contextoDoBanco,
  contextoSemBanco,
  FASES,
  interpretarArgumentos,
  salvarRelatorio,
} from '../src/database/import/feegow/runner';
import {
  formatarConferencia,
  verificarCarga,
  verificarSchema,
} from '../src/database/import/feegow/verificacao';

// Antes de qualquer conexão: fora de UTC, os created_at/updated_at históricos
// (colunas timestamp sem fuso) seriam gravados deslocados. Ver `fuso.ts`.
try {
  assertProcessoEmUtc();
} catch (erro) {
  console.error(`[import-feegow] ${(erro as Error).message}`);
  process.exit(1);
}

/**
 * Importa o backup estruturado do Feegow para a conta de um cliente.
 * Ver `planos-implementacao/MIG-07-importador-feegow.md`.
 *
 * Cada fase roda numa transação: ou entra tudo, ou nada. O `ledger.json`
 * (id Feegow → uuid INEXCI) só é salvo depois do COMMIT, de forma atômica, e
 * fica amarrado à conta e ao banco da carga: rodar o mesmo export para outra
 * conta/banco com o mesmo `--out` aborta (ver `Ledger.vincular`).
 *
 * Saída: 0 ok · 1 erro de uso/configuração · 2 falha na gravação.
 */
async function main(): Promise<void> {
  const opcoes = interpretarArgumentos(process.argv.slice(2));
  const exp = new ExportFeegow(opcoes.dir);
  const ledger = new Ledger(join(opcoes.out, 'ledger.json'));
  const fases =
    opcoes.fase === 'tudo'
      ? FASES
      : FASES.filter((f) => f.nome === opcoes.fase);

  let ds: DataSource | null = null;
  if (!opcoes.semBanco) {
    ds = await new DataSource({
      ...dataSourceOptions,
      logging: ['error'],
    }).initialize();
    const [{ current_database: banco }] = await ds.query(
      'SELECT current_database()',
    );
    assertBancoPermitido(banco, process.env.NODE_ENV);
    console.log(`[import-feegow] banco: ${banco}`);

    // As fases gravam colunas criadas pelas trilhas T1–T10: sem as
    // migrations, a transação morreria no meio com um erro cru do Postgres.
    const faltando = await verificarSchema((sql, p) => ds!.query(sql, p));
    if (faltando.length) {
      await ds.destroy();
      throw new Error(
        `Banco sem as migrations da migração Feegow (falta: ${faltando.join(', ')}). Rode "yarn typeorm:migration:run" antes.`,
      );
    }

    // O ledger só vale para a conta e o banco em que foi gerado: antes de
    // qualquer fase (inclusive dry-run e --verificar), confere o vínculo.
    try {
      const [dono] = await ds.query(
        `SELECT id FROM users WHERE lower(email) = $1 AND deleted_at IS NULL`,
        [opcoes.ownerEmail],
      );
      if (!dono) throw new Error(`Dono não encontrado: ${opcoes.ownerEmail}`);
      ledger.vincular(
        { ownerId: dono.id, banco },
        { adotar: opcoes.adotarLedger },
      );
    } catch (erro) {
      await ds.destroy();
      throw erro;
    }
  }

  if (opcoes.verificar) {
    try {
      const [dono] = await ds!.query(
        `SELECT id FROM users WHERE lower(email) = $1 AND deleted_at IS NULL`,
        [opcoes.ownerEmail],
      );
      if (!dono) throw new Error(`Dono não encontrado: ${opcoes.ownerEmail}`);
      const linhas = await verificarCarga(
        (sql, p) => ds!.query(sql, p),
        ledger,
        dono.id,
      );
      console.log(
        '== Conferência da carga (encontrados / previstos no ledger)',
      );
      console.log(
        linhas.length ? formatarConferencia(linhas) : '  ledger vazio.',
      );
      if (linhas.some((l) => l.encontrados !== l.previstos))
        process.exitCode = 2;
    } finally {
      await ds?.destroy();
    }
    return;
  }

  try {
    for (const fase of fases) {
      const trabalho = ledger.clonar();
      const relatorio = new Relatorio(fase.nome);
      const base = baseDoContexto(opcoes, trabalho, relatorio);
      const ctx = ds
        ? await contextoDoBanco(ds, opcoes.ownerEmail!, base)
        : contextoSemBanco(base);

      const plano = fase.planejar(exp, ctx);
      // Linhas malformadas das tabelas que esta fase leu.
      for (const p of exp.drenarProblemas()) {
        relatorio.rejeitar(`csv:${p.tabela}`, `linha ${p.linha}`, p.motivo);
      }
      console.log(relatorio.resumo());
      console.log(`  relatório: ${salvarRelatorio(opcoes.out, relatorio)}`);

      if (opcoes.dryRun) {
        // Nada gravado e o ledger.json não é salvo; mas a fase seguinte da
        // simulação precisa enxergar o que esta planejou (o paciente que a
        // agenda referencia), então o ledger em memória recebe o plano.
        absorver(ledger, trabalho);
        console.log('  dry-run: nada gravado.');
        continue;
      }

      if (opcoes.confirmar) {
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const resposta = await rl.question(
          `Gravar a fase "${fase.nome}" na conta de ${opcoes.ownerEmail}? Digite o e-mail do dono para confirmar: `,
        );
        rl.close();
        if (resposta.trim().toLowerCase() !== opcoes.ownerEmail) {
          console.log('  Cancelado.');
          return;
        }
      }

      // Arquivos sobem antes da transação (não dá para fazer rollback de
      // upload); se a gravação falhar, o que subiu é apagado.
      const armazenamento = fase.enviar
        ? criarArmazenamento(opcoes.out, fase.nome)
        : null;
      const enviados =
        fase.enviar && armazenamento
          ? await fase.enviar(plano, armazenamento)
          : [];
      if (enviados.length)
        console.log(`  ${enviados.length} arquivos enviados.`);
      try {
        await ds!.transaction((manager) => fase.gravar(plano, manager));
      } catch (erro) {
        if (armazenamento && enviados.length) {
          console.log('  gravação falhou: apagando os arquivos enviados...');
          // Se a limpeza falhar, o erro dela vai para o log e o da gravação
          // (a causa real) é que sobe.
          await limparEPropagar(erro, async () => {
            const falhas = await armazenamento.apagar(enviados);
            console.log(
              `  ${enviados.length - falhas.length} de ${enviados.length} arquivos apagados.`,
            );
          });
        }
        throw erro;
      }
      // Logo depois do COMMIT: se o ledger não for salvo, uma nova execução
      // não sabe o que já entrou e duplicaria a fase.
      salvarLedgerDepoisDoCommit(trabalho, fase.nome, opcoes.out);
      // As próximas fases resolvem referências pelo que acabou de entrar.
      absorver(ledger, trabalho);
      console.log(`  fase ${fase.nome} gravada; ledger atualizado.`);

      const descartados = fase.descartados?.(plano) ?? [];
      if (armazenamento && descartados.length) {
        // `apagar` não lança: o que ficou no bucket vai para o log e para
        // `orfaos-<fase>.json` (ver `comRegistroDeOrfaos`).
        const falhas = await armazenamento.apagar(descartados);
        console.log(
          `  ${descartados.length - falhas.length} de ${descartados.length} arquivos não usados apagados.`,
        );
      }
      // O envio/gravação pode ter rejeitado ou ajustado itens (arquivo
      // ilegível, consulta que virou encaixe por colidir com o banco…).
      console.log(relatorio.resumo());
      console.log(
        `  relatório atualizado: ${salvarRelatorio(opcoes.out, relatorio)}`,
      );
    }
  } finally {
    await ds?.destroy();
  }
}

/**
 * R2 montado fora do Nest, com as mesmas variáveis da API (`R2_ACCOUNT_ID`,
 * `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`). Chaves que não
 * puderem ser apagadas vão para `<out>/orfaos-<fase>.json`.
 */
function criarArmazenamento(
  out: string,
  fase: string,
): ArmazenamentoImportacao {
  const env = {
    get: (chave: string, padrao?: string) => process.env[chave] ?? padrao,
  } as unknown as ConfigService;
  const storage = new StorageService(createR2Client(env), {
    get: () => process.env.R2_BUCKET,
  } as unknown as ConfigService);
  return comRegistroDeOrfaos(
    {
      enviar: (a) =>
        storage.uploadBuffer(
          a.conteudo,
          a.pasta,
          a.nome,
          a.contentType,
          a.tenantId,
        ),
      // `deleteMany` nunca lança: devolve as chaves que falharam.
      apagar: (caminhos) =>
        apagarEmLotes(caminhos, (lote) => storage.deleteMany(lote)),
    },
    { out, fase },
  );
}

/**
 * Salva o ledger da fase recém-comitada. Se falhar, o banco já tem os dados
 * mas o ledger.json não: tenta deixar uma cópia ao lado e aborta com a
 * instrução — rodar de novo sem o ledger duplicaria a fase.
 */
function salvarLedgerDepoisDoCommit(
  trabalho: Ledger,
  fase: string,
  out: string,
): void {
  try {
    trabalho.salvar();
  } catch (erro) {
    const copia = join(out, `ledger.pendente-${fase}-${Date.now()}.json`);
    let onde = 'não deu para gravar a cópia';
    try {
      escreverAtomico(
        copia,
        JSON.stringify(
          {
            versao: 2,
            vinculo: trabalho.vinculo,
            registros: trabalho.paraObjeto(),
          },
          null,
          2,
        ),
      );
      onde = `cópia em ${copia}`;
    } catch {
      // segue com a mensagem acima
    }
    throw new Error(
      `Fase "${fase}" GRAVADA no banco, mas o ledger.json não foi salvo (${(erro as Error).message}); ${onde}. ` +
        'Restaure o ledger.json a partir da cópia antes de rodar qualquer fase de novo, senão os registros serão duplicados.',
    );
  }
}

/** Copia para `destino` tudo o que `origem` registrou. */
function absorver(destino: Ledger, origem: Ledger): void {
  for (const [entidade, mapa] of Object.entries(origem.paraObjeto())) {
    for (const [idOrigem, uuid] of Object.entries(mapa)) {
      destino.registrar(entidade, idOrigem, uuid);
    }
  }
}

main().catch((err: Error) => {
  console.error(`[import-feegow] ${err.message}`);
  process.exit(
    err.message.startsWith('--') || err.message.includes('Uso:') ? 1 : 2,
  );
});
