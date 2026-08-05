import { MigrationInterface, QueryRunner } from 'typeorm';
// Import relativo de propósito: as migrations rodam pelo CLI do TypeORM,
// carregadas por glob e fora do contexto do Nest. O módulo de verificações não
// importa nada da aplicação, então trazê-lo não puxa o Nest junto.
import {
  TELEFONE_DUPLICADO,
  montarDiagnostico,
  verificar,
} from '../preflight/data-checks';

export class AddUniqueIndexUserPhone1752300900000 implements MigrationInterface {
  name = 'AddUniqueIndexUserPhone1752300900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // O `CREATE UNIQUE INDEX` quebra em qualquer banco que já tenha telefone
    // repetido, e o erro do Postgres ("could not create unique index") não diz
    // quais contas colidem. Olhar o dado antes troca isso por um diagnóstico
    // acionável — a decisão de qual conta fica com o número é de quem opera,
    // não da migration: mexer em telefone de usuário real aqui seria destrutivo
    // e irreversível pelo `down()`.
    //
    // A mesma verificação roda em `yarn migration:preflight`, read-only, antes
    // de o deploy encostar na API.
    const conflitos = await verificar(TELEFONE_DUPLICADO, (sql) =>
      queryRunner.query(sql),
    );

    if (conflitos.length > 0) {
      throw new Error(montarDiagnostico(TELEFONE_DUPLICADO, conflitos));
    }

    // Sem unicidade, dois usuarios com telefones colidentes compartilhavam a
    // mesma conversa de WhatsApp, o mesmo draft e a mesma memoria.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_phone_unique"
       ON "users" ("phone") WHERE "phone" IS NOT NULL AND "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_phone_unique"`);
  }
}
