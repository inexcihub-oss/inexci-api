import { MigrationInterface, QueryRunner } from 'typeorm';
// Import relativo de propósito: as migrations rodam pelo CLI do TypeORM,
// carregadas por glob e fora do contexto do Nest.
import {
  SALAS_COM_NOME_REPETIDO,
  montarDiagnostico,
  verificar,
} from '../preflight/data-checks';

/** Nome do índice — o service o reconhece no `23505` para responder 409. */
export const UQ_CLINIC_ROOMS_CLINIC_NAME = 'uq_clinic_rooms_clinic_name_active';

/**
 * Nome de sala único por clínica, no banco. O `ClinicRoomsService` já recusa
 * nome repetido (`assertNomeLivre`), mas é check-then-insert: dois cadastros
 * simultâneos passam pela checagem antes de qualquer um gravar. O índice fecha
 * a corrida; o pré-check continua para a mensagem amigável, e o service traduz
 * o `23505` na mesma 409.
 *
 * Mesmo predicado da aplicação: sem diferenciar maiúsculas nem espaços nas
 * pontas, só entre salas não excluídas (soft delete libera o nome; inativa
 * continua ocupando, como no service). Expressão no índice, como
 * `uq_manufacturers_owner_name_active` — por isso não há `@Index` na entidade.
 */
export class AddUniqueClinicRoomName1755801000000 implements MigrationInterface {
  name = 'AddUniqueClinicRoomName1755801000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const conflitos = await verificar(SALAS_COM_NOME_REPETIDO, (sql) =>
      queryRunner.query(sql),
    );
    if (conflitos.length > 0) {
      throw new Error(montarDiagnostico(SALAS_COM_NOME_REPETIDO, conflitos));
    }

    await queryRunner.query(
      `CREATE UNIQUE INDEX "${UQ_CLINIC_ROOMS_CLINIC_NAME}" ON "clinic_rooms" ("clinic_id", lower(btrim("name"))) WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "${UQ_CLINIC_ROOMS_CLINIC_NAME}"`,
    );
  }
}
