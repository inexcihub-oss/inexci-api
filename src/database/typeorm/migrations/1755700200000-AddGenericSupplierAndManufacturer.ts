import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  OUTRO_NAO_UNIFICADO,
  montarDiagnostico,
  verificar,
} from '../preflight/data-checks';

/**
 * "Outro" deixa de ser um cadastro que cada conta cria sem querer e vira um
 * conceito da plataforma: uma linha por conta marcada com `is_generic`,
 * escondida do catálogo e criada sob demanda.
 *
 * Esta migration só entrega o schema — coluna e índice. A unificação das linhas
 * legadas "Outro"/"Outros" fica fora dela de propósito: aquelas linhas são
 * história do banco de produção, gravadas pelo preenchimento automático dos
 * slots de OPME quando ele mandava a string como se fosse um nome digitado. Um
 * banco criado do zero nunca teve esse código escrevendo nele, então não há o
 * que fundir — e fundir é destrutivo (renomeia, ressuscita soft-delete e apaga
 * linhas), coisa que não se quer amarrada ao start de um container.
 *
 * A fusão é feita uma vez, à mão, por `scripts/sql/outro-generico-aplicar.sql`.
 *
 * Duas consequências disso moldam o que está aqui:
 *
 * 1. **Idempotente.** Em produção o script cria coluna e índice antes desta
 *    migration rodar. Ele registra a migration como aplicada no fim, mas o
 *    `IF NOT EXISTS` é a rede de verdade — um registro que não bata (banco
 *    restaurado, ambiente clonado) traria a migration de volta contra um schema
 *    que já existe, e sem ele o deploy abortaria ali.
 *
 * 2. **Verifica antes.** Se o schema entrasse num banco com linha legada solta,
 *    `ensureGeneric` iria inserir a genérica chamada "Outro" e esbarrar no
 *    `uq_manufacturers_owner_name_active` — 500 em runtime, longe daqui. Então
 *    ela aborta com a lista do que falta fundir.
 */
export class AddGenericSupplierAndManufacturer1755700200000 implements MigrationInterface {
  name = 'AddGenericSupplierAndManufacturer1755700200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const naoUnificados = await verificar(OUTRO_NAO_UNIFICADO, (sql) =>
      queryRunner.query(sql),
    );
    if (naoUnificados.length > 0) {
      throw new Error(montarDiagnostico(OUTRO_NAO_UNIFICADO, naoUnificados));
    }

    await queryRunner.query(
      `ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "is_generic" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "is_generic" boolean NOT NULL DEFAULT false`,
    );

    // Uma genérica por conta. Parcial por `deleted_at` para acompanhar o soft
    // delete, como em `uq_manufacturers_owner_name_active`.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_suppliers_owner_generic"
         ON "suppliers" ("owner_id")
      WHERE "is_generic" AND "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_manufacturers_owner_generic"
         ON "manufacturers" ("owner_id")
      WHERE "is_generic" AND "deleted_at" IS NULL`,
    );
  }

  /**
   * Devolve o schema ao que era. Como a migration não funde mais nada, aqui não
   * há dado perdido a lamentar: o que o script de produção unificou continua
   * unificado, apenas sem a marca — e reaplicar a migration não refaz a fusão,
   * porque quem funde é o script.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_manufacturers_owner_generic"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_suppliers_owner_generic"`,
    );
    await queryRunner.query(
      `ALTER TABLE "manufacturers" DROP COLUMN IF EXISTS "is_generic"`,
    );
    await queryRunner.query(
      `ALTER TABLE "suppliers" DROP COLUMN IF EXISTS "is_generic"`,
    );
  }
}
