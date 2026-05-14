import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Infraestrutura: extensões, enums e funções utilitárias.
 *
 * Roda fora de transação para permitir `CREATE EXTENSION` (pgvector exige
 * que a operação ocorra fora de uma transação ativa em alguns ambientes).
 */
export class CreateInfrastructure1746144000000 implements MigrationInterface {
  name = 'CreateInfrastructure1746144000000';

  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "unaccent"`);

    const vectorAvailable = await queryRunner
      .query(`SELECT 1 FROM pg_available_extensions WHERE name = 'vector'`)
      .catch(() => []);

    if (!vectorAvailable.length) {
      throw new Error(
        'Extensão "pgvector" indisponível neste Postgres. ' +
          'Use a imagem `pgvector/pgvector:pg16` ou instale a extensão ' +
          'antes de rodar as migrations. Sem pgvector o RAG não pode ser inicializado.',
      );
    }

    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "vector"`);

    await queryRunner.query(`
      CREATE TYPE "user_role_enum" AS ENUM ('admin', 'collaborator');
    `);

    await queryRunner.query(`
      CREATE TYPE "user_status_enum" AS ENUM ('pending', 'active', 'inactive');
    `);

    await queryRunner.query(`
      CREATE TYPE "user_doctor_access_status_enum" AS ENUM ('active', 'inactive');
    `);

    await queryRunner.query(`
      CREATE TYPE "activity_type_enum" AS ENUM (
        'comment', 'status_change', 'system', 'pdf_generated'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE "notification_type_enum" AS ENUM (
        'new_surgery_request',
        'status_update',
        'pendency',
        'expiring_document',
        'action_by_user',
        'system',
        'info'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE "doctor_header_logo_position_enum" AS ENUM ('left', 'right');
    `);

    await queryRunner.query(`
      CREATE TYPE "notification_channel_enum" AS ENUM ('email', 'whatsapp');
    `);

    await queryRunner.query(`
      CREATE TYPE "notification_send_status_enum" AS ENUM (
        'queued', 'sent', 'delivered', 'read', 'failed'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE "contestation_type_enum" AS ENUM ('authorization', 'payment');
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION generate_protocol()
      RETURNS VARCHAR AS $$
      DECLARE
        new_protocol VARCHAR;
        protocol_exists BOOLEAN;
        attempts INTEGER := 0;
        max_attempts CONSTANT INTEGER := 100;
      BEGIN
        LOOP
          attempts := attempts + 1;
          IF attempts > max_attempts THEN
            RAISE EXCEPTION
              'generate_protocol: não foi possível gerar protocolo único após % tentativas',
              max_attempts;
          END IF;

          new_protocol := LPAD(FLOOR(RANDOM() * 900000 + 100000)::TEXT, 6, '0');
          SELECT EXISTS(
            SELECT 1 FROM surgery_requests WHERE protocol = new_protocol
          ) INTO protocol_exists;

          IF NOT protocol_exists THEN
            RETURN new_protocol;
          END IF;
        END LOOP;
      END;
      $$ LANGUAGE plpgsql;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS generate_protocol;`);

    const enums = [
      'contestation_type_enum',
      'notification_send_status_enum',
      'notification_channel_enum',
      'doctor_header_logo_position_enum',
      'notification_type_enum',
      'activity_type_enum',
      'user_doctor_access_status_enum',
      'user_status_enum',
      'user_role_enum',
    ];
    for (const enumName of enums) {
      await queryRunner.query(`DROP TYPE IF EXISTS "${enumName}";`);
    }

    await queryRunner.query(`DROP EXTENSION IF EXISTS "vector";`);
  }
}
