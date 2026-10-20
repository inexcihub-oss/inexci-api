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

try {
  assertProcessoEmUtc();
} catch (erro) {
  console.error(`[import-feegow] ${(erro as Error).message}`);
  process.exit(1);
}

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

    const faltando = await verificarSchema((sql, p) => ds!.query(sql, p));
    if (faltando.length) {
      await ds.destroy();
      throw new Error(
        `Banco sem as migrations da migração Feegow (falta: ${faltando.join(', ')}). Rode "yarn typeorm:migration:run" antes.`,
      );
    }

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
      for (const p of exp.drenarProblemas()) {
        relatorio.rejeitar(`csv:${p.tabela}`, `linha ${p.linha}`, p.motivo);
      }
      console.log(relatorio.resumo());
      console.log(`  relatório: ${salvarRelatorio(opcoes.out, relatorio)}`);

      if (opcoes.dryRun) {
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
          await limparEPropagar(erro, async () => {
            const falhas = await armazenamento.apagar(enviados);
            console.log(
              `  ${enviados.length - falhas.length} de ${enviados.length} arquivos apagados.`,
            );
          });
        }
        throw erro;
      }
      salvarLedgerDepoisDoCommit(trabalho, fase.nome, opcoes.out);
      absorver(ledger, trabalho);
      console.log(`  fase ${fase.nome} gravada; ledger atualizado.`);

      const descartados = fase.descartados?.(plano) ?? [];
      if (armazenamento && descartados.length) {
        const falhas = await armazenamento.apagar(descartados);
        console.log(
          `  ${descartados.length - falhas.length} de ${descartados.length} arquivos não usados apagados.`,
        );
      }
      console.log(relatorio.resumo());
      console.log(
        `  relatório atualizado: ${salvarRelatorio(opcoes.out, relatorio)}`,
      );
    }
  } finally {
    await ds?.destroy();
  }
}

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
      apagar: (caminhos) =>
        apagarEmLotes(caminhos, (lote) => storage.deleteMany(lote)),
    },
    { out, fase },
  );
}

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
    }
    throw new Error(
      `Fase "${fase}" GRAVADA no banco, mas o ledger.json não foi salvo (${(erro as Error).message}); ${onde}. ` +
        'Restaure o ledger.json a partir da cópia antes de rodar qualquer fase de novo, senão os registros serão duplicados.',
    );
  }
}

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
