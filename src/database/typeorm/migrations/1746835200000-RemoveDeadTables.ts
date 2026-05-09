import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remove tabelas que não são mais utilizadas em nenhuma rota ou serviço:
 *  - chats / chat_messages: a infraestrutura do chat por solicitação foi descontinuada;
 *    nenhum endpoint era consumido pelo frontend e nenhum serviço lia os registros.
 *  - default_document_clinics: o fluxo de "tipos de documento da clínica" foi removido
 *    junto com o endpoint /surgery-requests/documents-key.
 */
export class RemoveDeadTables1746835200000 implements MigrationInterface {
  name = 'RemoveDeadTables1746835200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_messages" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chats" CASCADE;`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "default_document_clinics" CASCADE;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "chats" (
        "id"                 UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id" UUID NOT NULL,
        "user_id"            UUID NOT NULL,
        "created_at"         TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_chats" PRIMARY KEY ("id"),
        CONSTRAINT "fk_chats_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_requests"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_chats_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_chats_sr_id" ON "chats" ("surgery_request_id");`,
    );

    await queryRunner.query(`
      CREATE TABLE "chat_messages" (
        "id"         UUID NOT NULL DEFAULT uuid_generate_v4(),
        "chat_id"    UUID NOT NULL,
        "sender_id"  UUID NOT NULL,
        "read"       BOOLEAN NOT NULL DEFAULT false,
        "message"    TEXT NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_chat_messages" PRIMARY KEY ("id"),
        CONSTRAINT "fk_chat_messages_chat"
          FOREIGN KEY ("chat_id") REFERENCES "chats"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_chat_messages_sender"
          FOREIGN KEY ("sender_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_chat_messages_chat_id" ON "chat_messages" ("chat_id");`,
    );

    await queryRunner.query(`
      CREATE TABLE "default_document_clinics" (
        "id"            UUID NOT NULL DEFAULT uuid_generate_v4(),
        "doctor_id"     UUID NOT NULL,
        "owner_id"      UUID NOT NULL,
        "created_by_id" UUID NOT NULL,
        "key"           VARCHAR(50) NOT NULL,
        "name"          VARCHAR(100) NOT NULL,
        "file_url"      VARCHAR(255),
        "description"   TEXT,
        "created_at"    TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_default_document_clinics" PRIMARY KEY ("id"),
        CONSTRAINT "fk_ddc_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_ddc_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_ddc_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_ddc_doctor_id" ON "default_document_clinics" ("doctor_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ddc_owner_id"  ON "default_document_clinics" ("owner_id");`,
    );
  }
}
