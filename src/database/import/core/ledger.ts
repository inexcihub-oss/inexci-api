import { existsSync, readFileSync, writeFileSync } from 'fs';

/**
 * Livro-razão local da importação: id no sistema de origem → uuid na INEXCI,
 * por tipo de entidade. Fica num `ledger.json` fora do repositório (ao lado do
 * export), não no banco.
 *
 * Serve a duas coisas: a fase seguinte resolve referências (a fase `agenda`
 * acha o uuid do paciente criado na fase `cadastro`), e uma fase que rodar de
 * novo pula o que já entrou em vez de duplicar.
 */
export class Ledger {
  private dados: Record<string, Record<string, string>>;

  constructor(
    private readonly caminho: string | null,
    inicial?: Record<string, Record<string, string>>,
  ) {
    this.dados =
      inicial ??
      (caminho && existsSync(caminho)
        ? (JSON.parse(readFileSync(caminho, 'utf-8')) as Record<
            string,
            Record<string, string>
          >)
        : {});
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

  total(entidade: string): number {
    return Object.keys(this.dados[entidade] ?? {}).length;
  }

  /** Cópia para planejar sem sujar o original (dry-run, rollback). */
  clonar(): Ledger {
    return new Ledger(this.caminho, JSON.parse(JSON.stringify(this.dados)));
  }

  salvar(): void {
    if (!this.caminho) return;
    writeFileSync(this.caminho, JSON.stringify(this.dados, null, 2));
  }

  paraObjeto(): Record<string, Record<string, string>> {
    return JSON.parse(JSON.stringify(this.dados));
  }
}
