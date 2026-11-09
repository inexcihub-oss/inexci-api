import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  TABELAS_DO_PAINEL_ADMIN,
  montarDiagnostico,
  verificar,
} from '../preflight/data-checks';

export class CreatePlatformAuditAndLastSeen1761000800000 implements MigrationInterface {
  name = 'CreatePlatformAuditAndLastSeen1761000800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const conflitos = await verificar(TABELAS_DO_PAINEL_ADMIN, (sql) =>
      queryRunner.query(sql),
    );
    if (conflitos.length > 0) {
      throw new Error(montarDiagnostico(TABELAS_DO_PAINEL_ADMIN, conflitos));
    }

    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "last_seen_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_users_last_seen_at" ON "users" ("last_seen_at")`,
    );
    await queryRunner.query(
      `CREATE TABLE "platform_admins" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "name" character varying(100) NOT NULL,
         "email" character varying(160) NOT NULL,
         "password_hash" character varying(255),
         "status" character varying(20) NOT NULL DEFAULT 'pending',
         "mfa_secret" text,
         "mfa_pending_secret" text,
         "mfa_enabled_at" TIMESTAMP WITH TIME ZONE,
         "mfa_recovery_codes" text[],
         "mfa_last_used_step" integer,
         "token_version" integer NOT NULL DEFAULT 0,
         "last_seen_at" TIMESTAMP WITH TIME ZONE,
         "invite_token_hash" character varying(64),
         "invite_expires_at" TIMESTAMP WITH TIME ZONE,
         "created_by_id" uuid,
         "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_platform_admins" PRIMARY KEY ("id"),
         CONSTRAINT "CHK_platform_admins_status"
           CHECK ("status" IN ('pending', 'active', 'inactive')),
         CONSTRAINT "FK_platform_admins_created_by"
           FOREIGN KEY ("created_by_id") REFERENCES "platform_admins"("id")
           ON DELETE SET NULL
       )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_platform_admins_email_lower"
         ON "platform_admins" (lower("email"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_platform_admins_created_by"
         ON "platform_admins" ("created_by_id")`,
    );
    await queryRunner.query(
      `CREATE TABLE "platform_audit_logs" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "actor_admin_id" uuid NOT NULL,
         "action" character varying(40) NOT NULL,
         "target_owner_id" uuid,
         "target_user_id" uuid,
         "target_admin_id" uuid,
         "reason" text,
         "before" jsonb,
         "after" jsonb,
         "gateway_ref" character varying(200),
         "status" character varying(20) NOT NULL DEFAULT 'pending',
         "error" text,
         "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "completed_at" TIMESTAMP WITH TIME ZONE,
         CONSTRAINT "PK_platform_audit_logs" PRIMARY KEY ("id"),
         CONSTRAINT "FK_platform_audit_logs_actor_admin"
           FOREIGN KEY ("actor_admin_id") REFERENCES "platform_admins"("id"),
         CONSTRAINT "FK_platform_audit_logs_target_admin"
           FOREIGN KEY ("target_admin_id") REFERENCES "platform_admins"("id")
           ON DELETE SET NULL
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_platform_audit_logs_target_owner_created"
         ON "platform_audit_logs" ("target_owner_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_platform_audit_logs_actor_created"
         ON "platform_audit_logs" ("actor_admin_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_platform_audit_logs_action_created"
         ON "platform_audit_logs" ("action", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_platform_audit_logs_target_admin"
         ON "platform_audit_logs" ("target_admin_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "platform_audit_logs"`);
    await queryRunner.query(`DROP TABLE "platform_admins"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_users_last_seen_at"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "last_seen_at"`);
  }
}
