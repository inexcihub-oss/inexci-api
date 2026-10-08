import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'fs';

/**
 * A quem o ledger pertence: a conta (dono) e o banco em que os uuids foram
 * criados. Um uuid do ledger só faz sentido nesse par — reaproveitá-lo em
 * outra conta ou outro banco faz a fase `cadastro` pular tudo e as seguintes
 * gravarem consultas/fichas da conta nova apontando para pacientes da antiga.
 */
export interface VinculoLedger {
  ownerId: string;
  /** `current_database()` da conexão. */
  banco: string;
}

/** Formato gravado no `ledger.json` a partir do vínculo com conta/banco. */
interface ArquivoLedgerV2 {
  versao: 2;
  vinculo: VinculoLedger;
  registros: Record<string, Record<string, string>>;
}

type Registros = Record<string, Record<string, string>>;

/**
 * Livro-razão local da importação: id no sistema de origem → uuid na INEXCI,
 * por tipo de entidade. Fica num `ledger.json` fora do repositório (ao lado do
 * export), não no banco.
 *
 * Serve a duas coisas: a fase seguinte resolve referências (a fase `agenda`
 * acha o uuid do paciente criado na fase `cadastro`), e uma fase que rodar de
 * novo pula o que já entrou em vez de duplicar.
 *
 * O arquivo carrega o vínculo (dono + banco) e o runner confere antes de
 * qualquer fase (`vincular`): ledger de outra conta/banco aborta a execução.
 */
export class Ledger {
  private dados: Registros;
  private vinculoAtual: VinculoLedger | null;
  /** Lido de um `ledger.json` do formato antigo, sem vínculo, com registros. */
  private readonly legadoComRegistros: boolean;

  constructor(
    private readonly caminho: string | null,
    inicial?: Registros,
    vinculo?: VinculoLedger | null,
  ) {
    if (inicial) {
      this.dados = inicial;
      this.vinculoAtual = vinculo ?? null;
      this.legadoComRegistros = false;
      return;
    }
    const lido =
      caminho && existsSync(caminho)
        ? (JSON.parse(readFileSync(caminho, 'utf-8')) as unknown)
        : {};
    if (ehArquivoV2(lido)) {
      this.dados = lido.registros;
      this.vinculoAtual = lido.vinculo;
      this.legadoComRegistros = false;
    } else {
      // Formato antigo (sem vínculo): só os registros, no topo do JSON.
      this.dados = lido as Registros;
      this.vinculoAtual = null;
      this.legadoComRegistros = Object.values(this.dados).some(
        (mapa) => Object.keys(mapa ?? {}).length > 0,
      );
    }
  }

  get vinculo(): VinculoLedger | null {
    return this.vinculoAtual ? { ...this.vinculoAtual } : null;
  }

  /**
   * Amarra o ledger à conta/banco desta execução, ou aborta.
   *
   * - Vínculo gravado diferente do atual → erro, sem saída: o ledger é de
   *   outra carga. Use outro `--out` (ledger novo) para esta conta/banco.
   * - Ledger vazio sem vínculo (primeira execução) → adota o atual.
   * - Ledger com registros mas sem vínculo (gravado antes desta checagem) →
   *   erro, a menos que `adotar` (`--adotar-ledger`). Não dá para saber de
   *   que conta/banco ele veio, e adotar por padrão repetiria exatamente o
   *   problema que a checagem existe para evitar; o operador confirma que é
   *   desta conta e deste banco.
   */
  vincular(atual: VinculoLedger, opcoes: { adotar?: boolean } = {}): void {
    const gravado = this.vinculoAtual;
    if (gravado) {
      const diferencas: string[] = [];
      if (gravado.ownerId !== atual.ownerId)
        diferencas.push(`dono ${gravado.ownerId} ≠ ${atual.ownerId}`);
      if (gravado.banco !== atual.banco)
        diferencas.push(`banco "${gravado.banco}" ≠ "${atual.banco}"`);
      if (diferencas.length) {
        throw new Error(
          `O ledger ${this.caminho ?? '(em memória)'} é de outra carga (${diferencas.join('; ')}). ` +
            'Use outro --out para importar nesta conta/banco; nunca reaproveite o ledger de outra conta.',
        );
      }
      return;
    }
    if (this.legadoComRegistros && !opcoes.adotar) {
      throw new Error(
        `O ledger ${this.caminho ?? '(em memória)'} não registra a conta nem o banco em que foi gerado (formato antigo). ` +
          `Se ele é mesmo da conta ${atual.ownerId} no banco "${atual.banco}", rode de novo com --adotar-ledger; ` +
          'senão, use outro --out.',
      );
    }
    this.vinculoAtual = { ...atual };
  }

  resolver(
    entidade: string,
    idOrigem: string | null | undefined,
  ): string | null {
    if (!idOrigem) return null;
    return this.dados[entidade]?.[idOrigem] ?? null;
  }

  registrar(entidade: string, idOrigem: string, uuid: string): void {
    (this.dados[entidade] ??= {})[idOrigem] = uuid;
  }

  /**
   * Desfaz o registro que aponta para `uuid` (o planejamento registrou, mas o
   * item acabou não entrando). Devolve o id de origem, ou `null`.
   */
  removerPorUuid(entidade: string, uuid: string): string | null {
    const mapa = this.dados[entidade];
    if (!mapa) return null;
    const idOrigem = Object.keys(mapa).find((k) => mapa[k] === uuid);
    if (idOrigem === undefined) return null;
    delete mapa[idOrigem];
    return idOrigem;
  }

  total(entidade: string): number {
    return Object.keys(this.dados[entidade] ?? {}).length;
  }

  /** Cópia para planejar sem sujar o original (dry-run, rollback). */
  clonar(): Ledger {
    return new Ledger(
      this.caminho,
      JSON.parse(JSON.stringify(this.dados)),
      this.vinculo,
    );
  }

  /**
   * Grava de forma atômica (arquivo temporário + `rename`): uma queda no meio
   * da escrita deixa o ledger anterior inteiro, nunca um JSON truncado — que
   * faria a próxima execução reimportar (duplicar) o que já está no banco.
   */
  salvar(): void {
    if (!this.caminho) return;
    if (!this.vinculoAtual) {
      throw new Error(
        'Ledger sem vínculo com conta/banco: chame vincular() antes de salvar.',
      );
    }
    const conteudo: ArquivoLedgerV2 = {
      versao: 2,
      vinculo: this.vinculoAtual,
      registros: this.dados,
    };
    escreverAtomico(this.caminho, JSON.stringify(conteudo, null, 2));
  }

  paraObjeto(): Registros {
    return JSON.parse(JSON.stringify(this.dados));
  }
}

function ehArquivoV2(valor: unknown): valor is ArquivoLedgerV2 {
  const v = valor as Partial<ArquivoLedgerV2> | null;
  return (
    !!v &&
    v.versao === 2 &&
    typeof v.vinculo?.ownerId === 'string' &&
    typeof v.vinculo?.banco === 'string' &&
    typeof v.registros === 'object' &&
    v.registros !== null
  );
}

/** Escreve em `<caminho>.tmp-<pid>`, faz fsync e renomeia por cima. */
export function escreverAtomico(caminho: string, conteudo: string): void {
  const temporario = `${caminho}.tmp-${process.pid}`;
  try {
    const fd = openSync(temporario, 'w');
    try {
      writeSync(fd, conteudo);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporario, caminho);
  } catch (erro) {
    try {
      unlinkSync(temporario);
    } catch {
      // já não existe
    }
    throw erro;
  }
}
