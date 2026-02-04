import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddUserProfileFields1768712900000 implements MigrationInterface {
  name = 'AddUserProfileFields1768712900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Adiciona campo specialty
    await queryRunner.addColumn(
      'user',
      new TableColumn({
        name: 'specialty',
        type: 'varchar',
        length: '100',
        isNullable: true,
      }),
    );

    // Adiciona campo crm
    await queryRunner.addColumn(
      'user',
      new TableColumn({
        name: 'crm',
        type: 'varchar',
        length: '20',
        isNullable: true,
      }),
    );

    // Adiciona campo crm_state
    await queryRunner.addColumn(
      'user',
      new TableColumn({
        name: 'crm_state',
        type: 'char',
        length: '2',
        isNullable: true,
      }),
    );

    // Adiciona campo avatar_url
    await queryRunner.addColumn(
      'user',
      new TableColumn({
        name: 'avatar_url',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );

    // Adiciona campo signature_url
    await queryRunner.addColumn(
      'user',
      new TableColumn({
        name: 'signature_url',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('user', 'signature_url');
    await queryRunner.dropColumn('user', 'avatar_url');
    await queryRunner.dropColumn('user', 'crm_state');
    await queryRunner.dropColumn('user', 'crm');
    await queryRunner.dropColumn('user', 'specialty');
  }
}
