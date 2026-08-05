import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { resolve } from 'path';
import { execSync } from 'child_process';
import {
  assertBancoDeTeste,
  comBancoDeTeste,
} from '../../src/shared/testing/e2e-database-guard';

config({ path: resolve(__dirname, '../../.env') });

/**
 * Verifica que a migration consolidada e o seed criaram
 * a estrutura e os dados esperados conforme o PRD v3.
 *
 * Nota: Roda o seed no beforeAll para garantir dados independente da
 * ordem de execução dos test suites (outros suites fazem cleanDatabase).
 */
describe('Database — Schema & Seed', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    // Conecta ao banco para limpar dados residuais de outros test suites
    dataSource = new DataSource({
      type: 'postgres',
      // Este spec abre a própria conexão e trunca por fora do
      // `cleanDatabase` — sem passar pelo redirecionador, o fallback
      // apontava para o banco de desenvolvimento.
      url: comBancoDeTeste(
        process.env.DATABASE_URL ??
          'postgresql://inexci:inexci123@localhost:5432/inexci',
      ),
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();

    // Limpa todas as tabelas antes de re-semear
    await assertBancoDeTeste(dataSource);
    const tables = await dataSource.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != 'migrations'`,
    );
    if (tables.length > 0) {
      const tableNames = tables.map((t: any) => `"${t.tablename}"`).join(', ');
      await dataSource.query(
        `TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE`,
      );
    }

    await dataSource.destroy();

    // Re-executa o seed para garantir dados limpos
    execSync('npm run seed', {
      cwd: resolve(__dirname, '../..'),
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'development' },
      timeout: 60000,
    });

    // Reconecta para os testes
    dataSource = new DataSource({
      type: 'postgres',
      // Este spec abre a própria conexão e trunca por fora do
      // `cleanDatabase` — sem passar pelo redirecionador, o fallback
      // apontava para o banco de desenvolvimento.
      url: comBancoDeTeste(
        process.env.DATABASE_URL ??
          'postgresql://inexci:inexci123@localhost:5432/inexci',
      ),
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();
  }, 120000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  // ─── Schema Validation ─────────────────────────────────────────────

  describe('Schema — Tabelas existentes', () => {
    /**
     * Nomes reais das tabelas. A lista anterior estava toda no singular
     * (`user`, `hospital`, `surgery_request`…) e ainda cobrava tabelas que
     * não existem mais — `status_update`, `chat`, `chat_message`,
     * `default_document_clinic` e `whatsapp_message_log`. Nenhuma asserção
     * passava; o teste virou ruído em vez de rede de proteção.
     */
    const expectedTables = [
      'appointments',
      'clinical_record_templates',
      'clinical_records',
      'contestations',
      'doctor_headers',
      'doctor_profiles',
      'documents',
      'health_plans',
      'hospitals',
      'manufacturers',
      'notification_send_logs',
      'notifications',
      'opme_item_manufacturers',
      'opme_item_suppliers',
      'opme_items',
      'patients',
      'procedures',
      'recovery_codes',
      'report_sections',
      'stale_notification_logs',
      'subscription_plans',
      'subscription_quota_periods',
      'subscriptions',
      'suppliers',
      'surgery_request_activities',
      'surgery_request_analyses',
      'surgery_request_billings',
      'surgery_request_quotations',
      'surgery_request_templates',
      'surgery_request_tuss_items',
      'surgery_requests',
      'user_doctor_accesses',
      'user_notification_settings',
      'users',
      'whatsapp_conversation_messages',
      'whatsapp_conversations',
    ];

    it.each(expectedTables)('tabela "%s" deve existir', async (tableName) => {
      const result = await dataSource.query(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1
        )`,
        [tableName],
      );
      expect(result[0].exists).toBe(true);
    });

    it('tabela "team_member" NÃO deve existir', async () => {
      const result = await dataSource.query(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'team_member'
        )`,
      );
      expect(result[0].exists).toBe(false);
    });

    it('tabela "cid" NÃO deve existir', async () => {
      const result = await dataSource.query(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'cid'
        )`,
      );
      expect(result[0].exists).toBe(false);
    });

    it('tabela "surgery_request_procedure" NÃO deve existir', async () => {
      const result = await dataSource.query(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'surgery_request_procedure'
        )`,
      );
      expect(result[0].exists).toBe(false);
    });
  });

  describe('Schema — Tabela "users"', () => {
    let columns: any[];

    beforeAll(async () => {
      columns = await dataSource.query(
        `SELECT column_name, data_type, udt_name, is_nullable
         FROM information_schema.columns
         WHERE table_name = 'users' AND table_schema = 'public'
         ORDER BY ordinal_position`,
      );
    });

    it('deve ter coluna "owner_id" UUID NOT NULL', () => {
      const col = columns.find((c) => c.column_name === 'owner_id');
      expect(col).toBeDefined();
      expect(col.udt_name).toBe('uuid');
      expect(col.is_nullable).toBe('NO');
    });

    it('deve ter coluna "role" com enum user_role_enum', () => {
      const col = columns.find((c) => c.column_name === 'role');
      expect(col).toBeDefined();
      expect(col.udt_name).toBe('user_role_enum');
    });

    it('deve ter coluna "status" com enum user_status_enum', () => {
      const col = columns.find((c) => c.column_name === 'status');
      expect(col).toBeDefined();
      expect(col.udt_name).toBe('user_status_enum');
    });

    it('NÃO deve ter colunas removidas (is_admin, is_doctor, crm, etc)', () => {
      const removedCols = [
        'is_admin',
        'is_doctor',
        'crm',
        'crm_state',
        'specialty',
        'signature_image_url',
      ];
      for (const colName of removedCols) {
        const col = columns.find((c) => c.column_name === colName);
        expect(col).toBeUndefined();
      }
    });

    it('user_role_enum deve conter apenas "admin" e "collaborator"', async () => {
      const result = await dataSource.query(
        `SELECT unnest(enum_range(NULL::user_role_enum))::text AS val`,
      );
      const values = result.map((r: any) => r.val);
      expect(values).toEqual(expect.arrayContaining(['admin', 'collaborator']));
      expect(values).not.toContain('doctor');
      expect(values.length).toBe(2);
    });
  });

  describe('Schema — Tabela "doctor_profiles"', () => {
    let columns: any[];

    beforeAll(async () => {
      columns = await dataSource.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'doctor_profiles' AND table_schema = 'public'`,
      );
    });

    it('NÃO deve ter colunas de subscription removidas', () => {
      const removedCols = [
        'subscription_status',
        'subscription_plan',
        'subscription_expires_at',
        'max_requests_per_month',
        'max_team_members',
      ];
      for (const colName of removedCols) {
        const col = columns.find((c: any) => c.column_name === colName);
        expect(col).toBeUndefined();
      }
    });

    it('deve ter colunas obrigatórias', () => {
      const requiredCols = [
        'id',
        'user_id',
        'crm',
        'crm_state',
        'specialty',
        'signature_url',
        'clinic_name',
        'clinic_cnpj',
        'clinic_address',
      ];
      for (const colName of requiredCols) {
        const col = columns.find((c: any) => c.column_name === colName);
        expect(col).toBeDefined();
      }
    });
  });

  describe('Schema — Tabela "user_doctor_accesses"', () => {
    let columns: any[];

    beforeAll(async () => {
      columns = await dataSource.query(
        `SELECT column_name, udt_name FROM information_schema.columns
         WHERE table_name = 'user_doctor_accesses' AND table_schema = 'public'`,
      );
    });

    it('deve ter colunas esperadas', () => {
      const expectedCols = [
        'id',
        'user_id',
        'doctor_user_id',
        'status',
        'created_by_id',
        'created_at',
        'updated_at',
      ];
      for (const colName of expectedCols) {
        expect(
          columns.find((c: any) => c.column_name === colName),
        ).toBeDefined();
      }
    });

    it('deve ter UNIQUE constraint em (user_id, doctor_user_id)', async () => {
      const result = await dataSource.query(
        `SELECT constraint_name FROM information_schema.table_constraints
         WHERE table_name = 'user_doctor_accesses'
         AND constraint_type = 'UNIQUE'`,
      );
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Schema — FKs de doctor_id apontam para users.id', () => {
    // Só estas duas ainda têm `doctor_id`: hospitais, convênios e
    // fornecedores viraram cadastros do tenant (`owner_id`), e
    // `default_document_clinic` não existe mais.
    const tablesWithDoctorFK = ['surgery_requests', 'patients'];

    it.each(tablesWithDoctorFK)(
      '%s.doctor_id deve ter FK para user(id)',
      async (tableName) => {
        const result = await dataSource.query(
          `SELECT ccu.table_name AS referenced_table
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
           JOIN information_schema.constraint_column_usage ccu
             ON tc.constraint_name = ccu.constraint_name
           WHERE tc.table_name = $1
             AND tc.constraint_type = 'FOREIGN KEY'
             AND kcu.column_name = 'doctor_id'`,
          [tableName],
        );
        expect(result.length).toBeGreaterThanOrEqual(1);
        expect(result[0].referenced_table).toBe('users');
      },
    );
  });

  describe('Schema — Índices', () => {
    // Nomes reais no banco. A lista anterior usava o padrão singular e
    // índices por `doctor_id` em cadastros que hoje são por `owner_id`.
    const expectedIndexes = [
      'idx_users_owner_id',
      'idx_users_admin_id',
      'idx_uda_user_status',
      'idx_uda_doctor_status',
      'idx_sr_doctor_id',
      'idx_sr_doctor_status',
      'idx_sr_owner_id',
      'idx_patients_doctor_id',
      'idx_patients_owner_id',
      'idx_hospitals_owner_id',
      'idx_health_plans_owner_id',
      'idx_procedures_owner_id',
    ];

    it.each(expectedIndexes)('índice "%s" deve existir', async (indexName) => {
      const result = await dataSource.query(
        `SELECT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = $1
        )`,
        [indexName],
      );
      expect(result[0].exists).toBe(true);
    });
  });

  // ─── Seed Validation ───────────────────────────────────────────────

  /**
   * O seed atual cria UMA conta (`medico@inexci.com`, admin + médico) com o
   * catálogo e a carteira cirúrgica dela. O bloco anterior cobrava um seed
   * com 4 usuários e as contas `admin@`, `medica@`, `assistente1@` e
   * `assistente2@inexci.com`, que não existem mais — nenhuma asserção
   * passava. Os números abaixo saem do próprio `seed.ts`.
   */
  describe('Seed — Dados criados', () => {
    const contar = async (tabela: string) => {
      const r = await dataSource.query(
        `SELECT COUNT(*) as count FROM ${tabela}`,
      );
      return parseInt(r[0].count);
    };

    it('deve ter os 9 planos de assinatura', async () => {
      expect(await contar('subscription_plans')).toBe(9);
    });

    it('deve ter 20 procedimentos no catálogo', async () => {
      expect(await contar('procedures')).toBe(20);
    });

    it('deve criar uma única conta (1 usuário admin + médico)', async () => {
      expect(await contar('users')).toBe(1);
      const admins = await dataSource.query(
        `SELECT COUNT(*) as count FROM users WHERE role = 'admin'`,
      );
      expect(parseInt(admins[0].count)).toBe(1);
      expect(await contar('doctor_profiles')).toBe(1);
    });

    it('o dono da conta é `medico@inexci.com`', async () => {
      const admin = await dataSource.query(
        `SELECT email FROM users WHERE role = 'admin'`,
      );
      expect(admin[0].email).toBe('medico@inexci.com');
    });

    it('admin deve ter owner_id = self.id (tenant aponta para si)', async () => {
      const admin = await dataSource.query(
        `SELECT id, owner_id FROM users WHERE role = 'admin'`,
      );
      expect(admin[0].id).toBe(admin[0].owner_id);
    });

    it('deve ter uma assinatura para o dono da conta', async () => {
      const admin = await dataSource.query(
        `SELECT id FROM users WHERE role = 'admin'`,
      );
      const subs = await dataSource.query(
        `SELECT COUNT(*) as count FROM subscriptions WHERE owner_id = $1`,
        [admin[0].id],
      );
      expect(parseInt(subs[0].count)).toBe(1);
    });

    it('deve ter os cadastros básicos da conta', async () => {
      expect(await contar('hospitals')).toBe(2);
      expect(await contar('health_plans')).toBe(3);
      expect(await contar('suppliers')).toBe(2);
      expect(await contar('manufacturers')).toBe(3);
    });

    it('deve ter 5 pacientes e 9 solicitações cirúrgicas', async () => {
      expect(await contar('patients')).toBe(5);
      expect(await contar('surgery_requests')).toBe(9);
    });

    it('as solicitações cobrem os 9 status do fluxo', async () => {
      const r = await dataSource.query(
        `SELECT DISTINCT status FROM surgery_requests ORDER BY status`,
      );
      expect(r.map((x: any) => Number(x.status))).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9,
      ]);
    });

    it('todo cadastro pertence ao tenant do dono (owner_id)', async () => {
      const admin = await dataSource.query(
        `SELECT id FROM users WHERE role = 'admin'`,
      );
      for (const tabela of [
        'hospitals',
        'health_plans',
        'suppliers',
        'patients',
        'surgery_requests',
      ]) {
        const fora = await dataSource.query(
          `SELECT COUNT(*) as count FROM ${tabela} WHERE owner_id <> $1`,
          [admin[0].id],
        );
        expect(parseInt(fora[0].count)).toBe(0);
      }
    });

    it('deve ter 2 templates de solicitação', async () => {
      expect(await contar('surgery_request_templates')).toBe(2);
    });
  });

  describe('Seed — Integridade referencial', () => {
    it('surgery_request.doctor_id não referencia doctor_profile.id', async () => {
      const result = await dataSource.query(`
        SELECT sr.doctor_id
        FROM surgery_requests sr
        LEFT JOIN doctor_profiles dp ON sr.doctor_id = dp.id
        WHERE dp.id IS NOT NULL
      `);
      // Nenhuma surgery_request.doctor_id deve casar com doctor_profile.id
      // (a menos que por coincidência de UUID, o que não deve acontecer)
      // Verificamos que todos os doctor_id casam com user.id
      const userCheck = await dataSource.query(`
        SELECT sr.id
        FROM surgery_requests sr
        JOIN users u ON sr.doctor_id = u.id
      `);
      const totalSR = await dataSource.query(
        `SELECT COUNT(*) as count FROM surgery_requests`,
      );
      expect(userCheck.length).toBe(parseInt(totalSR[0].count));
    });

    it('todos os doctor_user_id em user_doctor_accesses devem ter doctor_profile', async () => {
      const result = await dataSource.query(`
        SELECT uda.doctor_user_id
        FROM user_doctor_accesses uda
        LEFT JOIN doctor_profiles dp ON uda.doctor_user_id = dp.user_id
        WHERE dp.id IS NULL
      `);
      expect(result.length).toBe(0);
    });
  });
});
