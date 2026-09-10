import { MigrationInterface, QueryRunner } from 'typeorm';
// Import relativo de propósito: as migrations rodam pelo CLI do TypeORM,
// carregadas por glob e fora do contexto do Nest.
import {
  ORFAOS_ANTES_DA_CASCATA,
  montarDiagnostico,
  verificar,
} from '../preflight/data-checks';

/**
 * Torna possível apagar um usuário (e a conta inteira) sem limpar dependências
 * à mão antes.
 *
 * O que travava não eram as chaves para `users` — essas já cascateavam — e sim
 * os `RESTRICT` nas tabelas irmãs. Apagar o usuário cascateia para
 * `health_plans`, `hospitals` e `suppliers`, e o `RESTRICT` que `patients`,
 * `surgery_requests` e `surgery_request_quotations` mantinham sobre eles
 * abortava a operação inteira.
 *
 * Critério: relação opcional guarda o registro e perde só a referência
 * (`SET NULL`); relação obrigatória não sobrevive ao pai (`CASCADE`).
 *
 * `surgery_requests.created_by_id` é caso à parte: a coluna é NOT NULL, então
 * o `SET NULL` anterior nunca chegou a funcionar — apagar o usuário abortava
 * por violação de not-null, não por `RESTRICT`. Como `owner_id` já cascateia,
 * o `CASCADE` aqui só muda o caso de apagar um colaborador isolado da conta.
 *
 * Nada disso altera o comportamento do app: `User`, `Patient`, `HealthPlan`,
 * `Hospital` e `Supplier` são todos soft-delete, e soft-delete não dispara
 * ação referencial. Só exclusão física — administrativa, por SQL — chega aqui.
 */
export class FixUserDeletionReferentialActions1755700100000 implements MigrationInterface {
  name = 'FixUserDeletionReferentialActions1755700100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Recriar uma FK revalida as linhas existentes: uma órfã aborta o
    // `ADD CONSTRAINT` no meio da migration, com um erro que não diz qual é.
    // A mesma verificação roda em `yarn migration:preflight`, read-only, antes
    // de o deploy encostar na API.
    const orfaos = await verificar(ORFAOS_ANTES_DA_CASCATA, (sql) =>
      queryRunner.query(sql),
    );

    if (orfaos.length > 0) {
      throw new Error(montarDiagnostico(ORFAOS_ANTES_DA_CASCATA, orfaos));
    }

    await queryRunner.query(`
      ALTER TABLE "surgery_requests"
        DROP CONSTRAINT IF EXISTS "fk_surgery_requests_created_by",
        ADD CONSTRAINT "fk_surgery_requests_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE "surgery_requests"
        DROP CONSTRAINT IF EXISTS "fk_surgery_requests_hospital",
        ADD CONSTRAINT "fk_surgery_requests_hospital"
          FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id")
          ON DELETE SET NULL ON UPDATE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE "surgery_requests"
        DROP CONSTRAINT IF EXISTS "fk_surgery_requests_health_plan",
        ADD CONSTRAINT "fk_surgery_requests_health_plan"
          FOREIGN KEY ("health_plan_id") REFERENCES "health_plans"("id")
          ON DELETE SET NULL ON UPDATE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE "patients"
        DROP CONSTRAINT IF EXISTS "fk_patients_health_plan",
        ADD CONSTRAINT "fk_patients_health_plan"
          FOREIGN KEY ("health_plan_id") REFERENCES "health_plans"("id")
          ON DELETE SET NULL ON UPDATE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE "surgery_request_quotations"
        DROP CONSTRAINT IF EXISTS "fk_quotations_supplier",
        ADD CONSTRAINT "fk_quotations_supplier"
          FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "surgery_request_quotations"
        DROP CONSTRAINT IF EXISTS "fk_quotations_supplier",
        ADD CONSTRAINT "fk_quotations_supplier"
          FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE "patients"
        DROP CONSTRAINT IF EXISTS "fk_patients_health_plan",
        ADD CONSTRAINT "fk_patients_health_plan"
          FOREIGN KEY ("health_plan_id") REFERENCES "health_plans"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE "surgery_requests"
        DROP CONSTRAINT IF EXISTS "fk_surgery_requests_health_plan",
        ADD CONSTRAINT "fk_surgery_requests_health_plan"
          FOREIGN KEY ("health_plan_id") REFERENCES "health_plans"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE "surgery_requests"
        DROP CONSTRAINT IF EXISTS "fk_surgery_requests_hospital",
        ADD CONSTRAINT "fk_surgery_requests_hospital"
          FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE "surgery_requests"
        DROP CONSTRAINT IF EXISTS "fk_surgery_requests_created_by",
        ADD CONSTRAINT "fk_surgery_requests_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE CASCADE;
    `);
  }
}
