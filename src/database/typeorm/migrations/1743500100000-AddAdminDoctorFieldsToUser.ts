import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableForeignKey,
} from 'typeorm';

export class AddAdminDoctorFieldsToUser1743500100000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('user', [
      new TableColumn({
        name: 'is_admin',
        type: 'boolean',
        default: false,
      }),
      new TableColumn({
        name: 'is_doctor',
        type: 'boolean',
        default: false,
      }),
      new TableColumn({
        name: 'crm',
        type: 'varchar',
        length: '20',
        isNullable: true,
      }),
      new TableColumn({
        name: 'crm_state',
        type: 'char',
        length: '2',
        isNullable: true,
      }),
      new TableColumn({
        name: 'specialty',
        type: 'varchar',
        length: '100',
        isNullable: true,
      }),
      new TableColumn({
        name: 'signature_image_url',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
      new TableColumn({
        name: 'subscription_plan_id',
        type: 'uuid',
        isNullable: true,
      }),
      new TableColumn({
        name: 'admin_id',
        type: 'uuid',
        isNullable: true,
      }),
    ]);

    await queryRunner.createForeignKey(
      'user',
      new TableForeignKey({
        columnNames: ['subscription_plan_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'subscription_plan',
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createForeignKey(
      'user',
      new TableForeignKey({
        columnNames: ['admin_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'user',
        onDelete: 'SET NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('user');

    const fkPlan = table.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('subscription_plan_id') !== -1,
    );
    if (fkPlan) await queryRunner.dropForeignKey('user', fkPlan);

    const fkAdmin = table.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('admin_id') !== -1,
    );
    if (fkAdmin) await queryRunner.dropForeignKey('user', fkAdmin);

    await queryRunner.dropColumns('user', [
      'is_admin',
      'is_doctor',
      'crm',
      'crm_state',
      'specialty',
      'signature_image_url',
      'subscription_plan_id',
      'admin_id',
    ]);
  }
}
