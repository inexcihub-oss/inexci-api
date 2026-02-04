import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateDoctorCollaboratorTable1768714000000 implements MigrationInterface {
  name = 'CreateDoctorCollaboratorTable1768714000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Criar tabela doctor_collaborator
    await queryRunner.createTable(
      new Table({
        name: 'doctor_collaborator',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'doctor_id',
            type: 'int',
            isNullable: false,
          },
          {
            name: 'collaborator_id',
            type: 'int',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'smallint',
            default: 1,
            comment: '1=Pendente, 2=Ativo, 3=Inativo',
          },
          {
            name: 'access_level',
            type: 'smallint',
            default: 1,
            comment: '1=Visualização, 2=Edição, 3=Completo',
          },
          {
            name: 'can_create_requests',
            type: 'boolean',
            default: true,
          },
          {
            name: 'can_edit_requests',
            type: 'boolean',
            default: true,
          },
          {
            name: 'can_delete_requests',
            type: 'boolean',
            default: false,
          },
          {
            name: 'can_manage_documents',
            type: 'boolean',
            default: true,
          },
          {
            name: 'can_manage_billing',
            type: 'boolean',
            default: false,
          },
          {
            name: 'notes',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Criar índice único para evitar duplicatas
    await queryRunner.createIndex(
      'doctor_collaborator',
      new TableIndex({
        name: 'IDX_DOCTOR_COLLABORATOR_UNIQUE',
        columnNames: ['doctor_id', 'collaborator_id'],
        isUnique: true,
      }),
    );

    // Criar índices para consultas
    await queryRunner.createIndex(
      'doctor_collaborator',
      new TableIndex({
        name: 'IDX_DOCTOR_COLLABORATOR_DOCTOR',
        columnNames: ['doctor_id'],
      }),
    );

    await queryRunner.createIndex(
      'doctor_collaborator',
      new TableIndex({
        name: 'IDX_DOCTOR_COLLABORATOR_COLLABORATOR',
        columnNames: ['collaborator_id'],
      }),
    );

    await queryRunner.createIndex(
      'doctor_collaborator',
      new TableIndex({
        name: 'IDX_DOCTOR_COLLABORATOR_STATUS',
        columnNames: ['status'],
      }),
    );

    // Criar chaves estrangeiras
    await queryRunner.createForeignKey(
      'doctor_collaborator',
      new TableForeignKey({
        name: 'FK_DOCTOR_COLLABORATOR_DOCTOR',
        columnNames: ['doctor_id'],
        referencedTableName: 'user',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'doctor_collaborator',
      new TableForeignKey({
        name: 'FK_DOCTOR_COLLABORATOR_COLLABORATOR',
        columnNames: ['collaborator_id'],
        referencedTableName: 'user',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remover chaves estrangeiras
    await queryRunner.dropForeignKey(
      'doctor_collaborator',
      'FK_DOCTOR_COLLABORATOR_DOCTOR',
    );
    await queryRunner.dropForeignKey(
      'doctor_collaborator',
      'FK_DOCTOR_COLLABORATOR_COLLABORATOR',
    );

    // Remover índices
    await queryRunner.dropIndex(
      'doctor_collaborator',
      'IDX_DOCTOR_COLLABORATOR_STATUS',
    );
    await queryRunner.dropIndex(
      'doctor_collaborator',
      'IDX_DOCTOR_COLLABORATOR_COLLABORATOR',
    );
    await queryRunner.dropIndex(
      'doctor_collaborator',
      'IDX_DOCTOR_COLLABORATOR_DOCTOR',
    );
    await queryRunner.dropIndex(
      'doctor_collaborator',
      'IDX_DOCTOR_COLLABORATOR_UNIQUE',
    );

    // Remover tabela
    await queryRunner.dropTable('doctor_collaborator');
  }
}
