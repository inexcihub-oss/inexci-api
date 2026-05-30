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

  private async createEnumIfNotExists(
    queryRunner: QueryRunner,
    enumName: string,
    enumValues: string,
  ): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${enumName}') THEN
          CREATE TYPE "${enumName}" AS ENUM (${enumValues});
        END IF;
      END
      $$;
    `);
  }

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

    await this.createEnumIfNotExists(
      queryRunner,
      'user_role_enum',
      `'admin', 'collaborator'`,
    );

    await this.createEnumIfNotExists(
      queryRunner,
      'user_status_enum',
      `'pending', 'active', 'inactive'`,
    );

    await this.createEnumIfNotExists(
      queryRunner,
      'user_doctor_access_status_enum',
      `'active', 'inactive'`,
    );

    await this.createEnumIfNotExists(
      queryRunner,
      'activity_type_enum',
      `'comment', 'status_change', 'system', 'pdf_generated'`,
    );

    await this.createEnumIfNotExists(
      queryRunner,
      'notification_type_enum',
      `'new_surgery_request', 'status_update', 'pendency', 'expiring_document', 'action_by_user', 'system', 'info'`,
    );

    await this.createEnumIfNotExists(
      queryRunner,
      'doctor_header_logo_position_enum',
      `'left', 'right'`,
    );

    await this.createEnumIfNotExists(
      queryRunner,
      'notification_channel_enum',
      `'email', 'whatsapp'`,
    );

    await this.createEnumIfNotExists(
      queryRunner,
      'notification_send_status_enum',
      `'queued', 'sent', 'delivered', 'read', 'failed'`,
    );

    await this.createEnumIfNotExists(
      queryRunner,
      'contestation_type_enum',
      `'authorization', 'payment'`,
    );

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
