/** Linha do sistema de origem que não entrou, com o motivo. */
export interface Rejeicao {
  entidade: string;
  idOrigem: string;
  motivo: string;
}

/** Algo que entrou, mas merece revisão (CPF inválido descartado etc.). */
export interface Aviso {
  entidade: string;
  idOrigem: string;
  aviso: string;
  /** Complemento por linha (ex.: o outro paciente com o mesmo CPF). */
  detalhe?: string;
}

/**
 * Relatório de uma fase: o que entra, o que não entra e por quê. É o que o
 * cliente revisa no dry-run antes da carga.
 */
export class Relatorio {
  readonly aceitos: Record<string, number> = {};
  readonly pulados: Record<string, number> = {};
  readonly rejeicoes: Rejeicao[] = [];
  readonly avisos: Aviso[] = [];
  readonly extras: Record<string, unknown> = {};

  constructor(readonly fase: string) {}

  aceitar(entidade: string, quantidade = 1): void {
    this.aceitos[entidade] = (this.aceitos[entidade] ?? 0) + quantidade;
  }

  /**
   * O planejamento aceitou, mas o item não entrou (arquivo ilegível no
   * upload etc.): tira da contagem e registra a rejeição.
   */
  rejeitarAceito(entidade: string, idOrigem: string, motivo: string): void {
    if (this.aceitos[entidade]) this.aceitos[entidade]--;
    this.rejeitar(entidade, idOrigem, motivo);
  }

  /** O planejamento aceitou, mas o item não entrou: só tira da contagem. */
  desfazerAceite(entidade: string): void {
    if (this.aceitos[entidade]) this.aceitos[entidade]--;
  }

  /** Já importado numa execução anterior (está no ledger). */
  pular(entidade: string): void {
    this.pulados[entidade] = (this.pulados[entidade] ?? 0) + 1;
  }

  rejeitar(entidade: string, idOrigem: string, motivo: string): void {
    this.rejeicoes.push({ entidade, idOrigem, motivo });
  }

  avisar(
    entidade: string,
    idOrigem: string,
    aviso: string,
    detalhe?: string,
  ): void {
    this.avisos.push({
      entidade,
      idOrigem,
      aviso,
      ...(detalhe ? { detalhe } : {}),
    });
  }

  /** Contagem por motivo, para o resumo no terminal. */
  static agrupar<T>(
    itens: T[],
    chave: (item: T) => string,
  ): [string, number][] {
    const contagem = new Map<string, number>();
    for (const item of itens) {
      const k = chave(item);
      contagem.set(k, (contagem.get(k) ?? 0) + 1);
    }
    return [...contagem.entries()].sort((a, b) => b[1] - a[1]);
  }

  resumo(): string {
    const linhas = [`== Fase ${this.fase}`];
    for (const [e, n] of Object.entries(this.aceitos)) {
      linhas.push(`  ${e}: ${n} a gravar`);
    }
    for (const [e, n] of Object.entries(this.pulados)) {
      linhas.push(`  ${e}: ${n} já importados (pulados)`);
    }
    if (this.rejeicoes.length) {
      linhas.push(`  Rejeitados (${this.rejeicoes.length}):`);
      for (const [k, n] of Relatorio.agrupar(
        this.rejeicoes,
        (r) => `${r.entidade} — ${r.motivo}`,
      )) {
        linhas.push(`    ${n} × ${k}`);
      }
    }
    if (this.avisos.length) {
      linhas.push(`  Avisos (${this.avisos.length}):`);
      for (const [k, n] of Relatorio.agrupar(
        this.avisos,
        (a) => `${a.entidade} — ${a.aviso}`,
      )) {
        linhas.push(`    ${n} × ${k}`);
      }
    }
    return linhas.join('\n');
  }

  paraJson(): object {
    return {
      fase: this.fase,
      aceitos: this.aceitos,
      pulados: this.pulados,
      rejeicoes: this.rejeicoes,
      avisos: this.avisos,
      ...this.extras,
    };
  }
}
