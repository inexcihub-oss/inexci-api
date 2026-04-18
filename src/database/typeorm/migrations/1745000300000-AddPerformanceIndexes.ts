import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPerformanceIndexes1745000300000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_surgery_request_doctor_id ON surgery_request(doctor_id);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_surgery_request_status ON surgery_request(status);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_surgery_request_created_at ON surgery_request(created_at DESC);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_surgery_request_health_plan_id ON surgery_request(health_plan_id);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_surgery_request_hospital_id ON surgery_request(hospital_id);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_activity_surgery_request_id ON surgery_request_activity(surgery_request_id);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_surgery_request_id ON chat(surgery_request_id);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_document_surgery_request_id ON document(surgery_request_id);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_quotation_surgery_request_id ON surgery_request_quotation(surgery_request_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_surgery_request_doctor_id;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_surgery_request_status;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_surgery_request_created_at;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_surgery_request_health_plan_id;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_surgery_request_hospital_id;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_activity_surgery_request_id;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_chat_surgery_request_id;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_document_surgery_request_id;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_quotation_surgery_request_id;`);
  }
}
