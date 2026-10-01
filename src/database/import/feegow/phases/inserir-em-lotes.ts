import { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';

/** Tamanho do lote por INSERT: longe do limite de parâmetros do Postgres. */
const LOTE = 200;

export async function inserirEmLotes<T extends ObjectLiteral>(
  manager: EntityManager,
  entidade: EntityTarget<T>,
  linhas: object[],
  ignorarConflito = false,
): Promise<void> {
  for (let i = 0; i < linhas.length; i += LOTE) {
    const qb = manager
      .createQueryBuilder()
      .insert()
      .into(entidade)
      .values(linhas.slice(i, i + LOTE) as never);
    if (ignorarConflito) qb.orIgnore();
    await qb.execute();
  }
}
