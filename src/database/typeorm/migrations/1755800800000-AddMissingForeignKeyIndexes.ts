import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dois acertos nas tabelas criadas pelas migrations 1755800300000 a
 * 1755800700000, sem mexer em dado nenhum:
 *
 * 1. **Índices nas FKs com `ON DELETE SET NULL`** que ficaram sem índice:
 *    `appointments.health_plan_id`, `appointments.created_by_id` e
 *    `schedule_blocks.created_by_id`. Sem eles, excluir um convênio ou um
 *    usuário varre a tabela inteira para anular as referências.
 *
 * 2. **Nomes explícitos de constraint.** Aquelas migrations declararam FK e
 *    CHECK inline (`REFERENCES ...`, `CHECK (...)`), e o Postgres os batizou
 *    sozinho (`<tabela>_<coluna>_fkey`, `<tabela>_<coluna>_check`). O TypeORM
 *    compara constraint por nome: com o nome automático de um lado e o hash do
 *    naming strategy do outro, `migration:generate` sairia derrubando e
 *    recriando tudo. Aqui os nomes viram `FK_<tabela>_<relação>` /
 *    `CHK_<tabela>_<coluna>` — os mesmos declarados nas entidades.
 *
 * Só renomeia e cria índice comum: não aperta o schema, não precisa de
 * pré-flight. A renomeação localiza a constraint pela coluna (não pelo nome
 * automático), então funciona mesmo se o Postgres tiver escolhido outro nome.
 */

interface Renomeacao {
  tabela: string;
  coluna: string;
  /** `f` = chave estrangeira, `c` = CHECK (como em `pg_constraint.contype`). */
  tipo: 'f' | 'c';
  nome: string;
}

const RENOMEACOES: Renomeacao[] = [
  {
    tabela: 'clinic_rooms',
    coluna: 'owner_id',
    tipo: 'f',
    nome: 'FK_clinic_rooms_owner',
  },
  {
    tabela: 'clinic_rooms',
    coluna: 'clinic_id',
    tipo: 'f',
    nome: 'FK_clinic_rooms_clinic',
  },
  {
    tabela: 'clinical_document_templates',
    coluna: 'owner_id',
    tipo: 'f',
    nome: 'FK_clinical_document_templates_owner',
  },
  {
    tabela: 'clinical_document_templates',
    coluna: 'doctor_id',
    tipo: 'f',
    nome: 'FK_clinical_document_templates_doctor',
  },
  {
    tabela: 'doctor_schedules',
    coluna: 'owner_id',
    tipo: 'f',
    nome: 'FK_doctor_schedules_owner',
  },
  {
    tabela: 'doctor_schedules',
    coluna: 'doctor_id',
    tipo: 'f',
    nome: 'FK_doctor_schedules_doctor',
  },
  {
    tabela: 'doctor_schedules',
    coluna: 'clinic_id',
    tipo: 'f',
    nome: 'FK_doctor_schedules_clinic',
  },
  {
    tabela: 'doctor_schedules',
    coluna: 'room_id',
    tipo: 'f',
    nome: 'FK_doctor_schedules_room',
  },
  {
    tabela: 'doctor_schedules',
    coluna: 'weekday',
    tipo: 'c',
    nome: 'CHK_doctor_schedules_weekday',
  },
  {
    tabela: 'doctor_schedules',
    coluna: 'slot_minutes',
    tipo: 'c',
    nome: 'CHK_doctor_schedules_slot_minutes',
  },
  {
    tabela: 'schedule_blocks',
    coluna: 'owner_id',
    tipo: 'f',
    nome: 'FK_schedule_blocks_owner',
  },
  {
    tabela: 'schedule_blocks',
    coluna: 'doctor_id',
    tipo: 'f',
    nome: 'FK_schedule_blocks_doctor',
  },
  {
    tabela: 'schedule_blocks',
    coluna: 'clinic_id',
    tipo: 'f',
    nome: 'FK_schedule_blocks_clinic',
  },
  {
    tabela: 'schedule_blocks',
    coluna: 'created_by_id',
    tipo: 'f',
    nome: 'FK_schedule_blocks_created_by',
  },
  {
    tabela: 'holidays',
    coluna: 'owner_id',
    tipo: 'f',
    nome: 'FK_holidays_owner',
  },
];

/** Nome que o Postgres dá a FK/CHECK inline de uma coluna só. */
function nomeAutomatico({ tabela, coluna, tipo }: Renomeacao): string {
  return `${tabela}_${coluna}_${tipo === 'f' ? 'fkey' : 'check'}`;
}

/**
 * Renomeia a constraint de uma coluna só (do tipo pedido) para `destino`.
 * Aborta se ela não existir: significa que o schema não é o que as migrations
 * anteriores deixaram, e seguir adiante esconderia o problema.
 */
async function renomear(
  queryRunner: QueryRunner,
  renomeacao: Renomeacao,
  destino: string,
): Promise<void> {
  const { tabela, coluna, tipo } = renomeacao;
  const linhas = (await queryRunner.query(
    `SELECT c."conname" AS nome
       FROM "pg_constraint" c
       JOIN "pg_attribute" a
         ON a."attrelid" = c."conrelid" AND a."attnum" = ANY (c."conkey")
      WHERE c."conrelid" = $1::regclass
        AND c."contype" = $2
        AND a."attname" = $3
        AND array_length(c."conkey", 1) = 1`,
    [`"${tabela}"`, tipo, coluna],
  )) as { nome: string }[] | undefined;

  if (!linhas || linhas.length !== 1) {
    throw new Error(
      `Esperava 1 constraint (${tipo}) em "${tabela}"."${coluna}", encontrei ${linhas?.length ?? 0}.`,
    );
  }
  const atual = linhas[0].nome;
  if (atual === destino) return;

  await queryRunner.query(
    `ALTER TABLE "${tabela}" RENAME CONSTRAINT "${atual}" TO "${destino}"`,
  );
}

export class AddMissingForeignKeyIndexes1755800800000 implements MigrationInterface {
  name = 'AddMissingForeignKeyIndexes1755800800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_appointments_health_plan_id" ON "appointments" ("health_plan_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_appointments_created_by_id" ON "appointments" ("created_by_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_schedule_blocks_created_by_id" ON "schedule_blocks" ("created_by_id")`,
    );

    for (const renomeacao of RENOMEACOES) {
      await renomear(queryRunner, renomeacao, renomeacao.nome);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const renomeacao of [...RENOMEACOES].reverse()) {
      await renomear(queryRunner, renomeacao, nomeAutomatico(renomeacao));
    }

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_schedule_blocks_created_by_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_appointments_created_by_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_appointments_health_plan_id"`,
    );
  }
}
