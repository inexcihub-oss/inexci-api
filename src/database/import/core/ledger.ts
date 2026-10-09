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

export interface VinculoLedger {
  ownerId: string;
  banco: string;
}

interface ArquivoLedgerV2 {
  versao: 2;
  vinculo: VinculoLedger;
  registros: Record<string, Record<string, string>>;
}

type Registros = Record<string, Record<string, string>>;

export class Ledger {
  private dados: Registros;
  private vinculoAtual: VinculoLedger | null;
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

  clonar(): Ledger {
    return new Ledger(
      this.caminho,
      JSON.parse(JSON.stringify(this.dados)),
      this.vinculo,
    );
  }

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
    } catch {}
    throw erro;
  }
}
