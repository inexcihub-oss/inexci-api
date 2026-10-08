import { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';

/** Tamanho do lote por INSERT: longe do limite de parâmetros do Postgres. */
const LOTE = 200;

export async function inserirEmLotes<T extends ObjectLiteral>(
  manager: EntityManager,
  entidade: EntityTarget<T>,
  linhas: object[],
  ignorarConflito = false,
  lote = LOTE,
): Promise<void> {
  for (let i = 0; i < linhas.length; i += lote) {
    const qb = manager
      .createQueryBuilder()
      .insert()
      .into(entidade)
      .values(linhas.slice(i, i + lote) as never);
    if (ignorarConflito) qb.orIgnore();
    await qb.execute();
  }
}
