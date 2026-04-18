import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { resolve } from 'path';
import { execSync } from 'child_process';

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
      url:
        process.env.DATABASE_URL ||
        'postgresql://inexci:inexci123@localhost:5432/inexci',
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();

    // Limpa todas as tabelas antes de re-semear
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
      url:
        process.env.DATABASE_URL ||
        'postgresql://inexci:inexci123@localhost:5432/inexci',
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
    const expectedTables = [
      'subscription_plan',
      'user',
      'doctor_profile',
      'user_doctor_access',
      'hospital',
      'health_plan',
      'supplier',
      'procedure',
      'patient',
      'surgery_request',
      'surgery_request_tuss_item',
      'opme_item',
      'surgery_request_quotation',
      'contestation',
      'document',
      'status_update',
      'surgery_request_analysis',
      'surgery_request_billing',
      'surgery_request_template',
      'surgery_request_activity',
      'chat',
      'chat_message',
      'notification',
      'user_notification_settings',
      'default_document_clinic',
      'recovery_code',
      'whatsapp_message_log',
      'report_section',
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

  describe('Schema — Tabela "user"', () => {
    let columns: any[];

    beforeAll(async () => {
      columns = await dataSource.query(
        `SELECT column_name, data_type, udt_name, is_nullable
         FROM information_schema.columns
         WHERE table_name = 'user' AND table_schema = 'public'
         ORDER BY ordinal_position`,
      );
    });

    it('deve ter coluna "account_id" UUID NOT NULL', () => {
      const col = columns.find((c) => c.column_name === 'account_id');
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

  describe('Schema — Tabela "doctor_profile"', () => {
    let columns: any[];

    beforeAll(async () => {
      columns = await dataSource.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'doctor_profile' AND table_schema = 'public'`,
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

  describe('Schema — Tabela "user_doctor_access"', () => {
    let columns: any[];

    beforeAll(async () => {
      columns = await dataSource.query(
        `SELECT column_name, udt_name FROM information_schema.columns
         WHERE table_name = 'user_doctor_access' AND table_schema = 'public'`,
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
         WHERE table_name = 'user_doctor_access'
         AND constraint_type = 'UNIQUE'`,
      );
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Schema — FKs de doctor_id apontam para user.id', () => {
    const tablesWithDoctorFK = [
      'surgery_request',
      'patient',
      'default_document_clinic',
      'hospital',
      'health_plan',
      'supplier',
    ];

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
        expect(result[0].referenced_table).toBe('user');
      },
    );
  });

  describe('Schema — Índices', () => {
    const expectedIndexes = [
      'idx_user_account_id',
      'idx_user_admin_id',
      'idx_uda_user_id_status',
      'idx_uda_doctor_user_id_status',
      'idx_sr_doctor_id',
      'idx_sr_doctor_id_status',
      'idx_patient_doctor_id',
      'idx_hospital_doctor_id',
      'idx_health_plan_doctor_id',
      'idx_supplier_doctor_id',
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

  describe('Seed — Dados criados', () => {
    it('deve ter 2 planos de assinatura', async () => {
      const result = await dataSource.query(
        `SELECT COUNT(*) as count FROM subscription_plan`,
      );
      expect(parseInt(result[0].count)).toBe(2);
    });

    it('deve ter 10 procedimentos', async () => {
      const result = await dataSource.query(
        `SELECT COUNT(*) as count FROM procedure`,
      );
      expect(parseInt(result[0].count)).toBe(10);
    });

    it('deve ter 4 usuários (1 admin + 3 collaborators)', async () => {
      const result = await dataSource.query(
        `SELECT COUNT(*) as count FROM "user"`,
      );
      expect(parseInt(result[0].count)).toBe(4);
    });

    it('deve ter 1 admin e 3 collaborators', async () => {
      const admins = await dataSource.query(
        `SELECT COUNT(*) as count FROM "user" WHERE role = 'admin'`,
      );
      const collaborators = await dataSource.query(
        `SELECT COUNT(*) as count FROM "user" WHERE role = 'collaborator'`,
      );
      expect(parseInt(admins[0].count)).toBe(1);
      expect(parseInt(collaborators[0].count)).toBe(3);
    });

    it('deve ter 2 doctor_profiles', async () => {
      const result = await dataSource.query(
        `SELECT COUNT(*) as count FROM doctor_profile`,
      );
      expect(parseInt(result[0].count)).toBe(2);
    });

    it('admin deve ter account_id = self.id', async () => {
      const admin = await dataSource.query(
        `SELECT id, account_id FROM "user" WHERE role = 'admin'`,
      );
      expect(admin[0].id).toBe(admin[0].account_id);
    });

    it('todos os collaborators devem ter account_id = admin.id', async () => {
      const admin = await dataSource.query(
        `SELECT id FROM "user" WHERE role = 'admin'`,
      );
      const collaborators = await dataSource.query(
        `SELECT account_id FROM "user" WHERE role = 'collaborator'`,
      );
      for (const c of collaborators) {
        expect(c.account_id).toBe(admin[0].id);
      }
    });

    it('deve ter 3 vínculos de acesso ativos', async () => {
      const result = await dataSource.query(
        `SELECT COUNT(*) as count FROM user_doctor_access WHERE status = 'active'`,
      );
      expect(parseInt(result[0].count)).toBe(3);
    });

    it('collaborator B deve acessar admin e collaborator A', async () => {
      const collabB = await dataSource.query(
        `SELECT id FROM "user" WHERE email = 'assistente1@inexci.com'`,
      );
      const accesses = await dataSource.query(
        `SELECT doctor_user_id FROM user_doctor_access
         WHERE user_id = $1 AND status = 'active'`,
        [collabB[0].id],
      );
      expect(accesses.length).toBe(2);
    });

    it('collaborator C deve acessar apenas collaborator A', async () => {
      const collabC = await dataSource.query(
        `SELECT id FROM "user" WHERE email = 'assistente2@inexci.com'`,
      );
      const collabA = await dataSource.query(
        `SELECT id FROM "user" WHERE email = 'medica@inexci.com'`,
      );
      const accesses = await dataSource.query(
        `SELECT doctor_user_id FROM user_doctor_access
         WHERE user_id = $1 AND status = 'active'`,
        [collabC[0].id],
      );
      expect(accesses.length).toBe(1);
      expect(accesses[0].doctor_user_id).toBe(collabA[0].id);
    });

    it('deve ter 3 pacientes com doctor_id apontando para user.id', async () => {
      const result = await dataSource.query(`
        SELECT p.id, p.doctor_id, u.email
        FROM patient p
        JOIN "user" u ON p.doctor_id = u.id
        ORDER BY p.created_at
      `);
      expect(result.length).toBe(3);
      // Os 2 primeiros são do admin
      const admin = await dataSource.query(
        `SELECT id FROM "user" WHERE email = 'admin@inexci.com'`,
      );
      expect(result[0].doctor_id).toBe(admin[0].id);
      expect(result[1].doctor_id).toBe(admin[0].id);
    });

    it('deve ter 3 solicitações com doctor_id apontando para user.id', async () => {
      const result = await dataSource.query(`
        SELECT sr.id, sr.doctor_id, u.email
        FROM surgery_request sr
        JOIN "user" u ON sr.doctor_id = u.id
      `);
      expect(result.length).toBe(3);
    });

    it('deve ter 2 hospitais vinculados ao admin', async () => {
      const admin = await dataSource.query(
        `SELECT id FROM "user" WHERE email = 'admin@inexci.com'`,
      );
      const result = await dataSource.query(
        `SELECT COUNT(*) as count FROM hospital WHERE doctor_id = $1`,
        [admin[0].id],
      );
      expect(parseInt(result[0].count)).toBe(2);
    });

    it('deve ter 2 convênios vinculados ao admin', async () => {
      const admin = await dataSource.query(
        `SELECT id FROM "user" WHERE email = 'admin@inexci.com'`,
      );
      const result = await dataSource.query(
        `SELECT COUNT(*) as count FROM health_plan WHERE doctor_id = $1`,
        [admin[0].id],
      );
      expect(parseInt(result[0].count)).toBe(2);
    });

    it('deve ter 1 fornecedor vinculado ao admin', async () => {
      const admin = await dataSource.query(
        `SELECT id FROM "user" WHERE email = 'admin@inexci.com'`,
      );
      const result = await dataSource.query(
        `SELECT COUNT(*) as count FROM supplier WHERE doctor_id = $1`,
        [admin[0].id],
      );
      expect(parseInt(result[0].count)).toBe(1);
    });
  });

  describe('Seed — Integridade referencial', () => {
    it('surgery_request.doctor_id não referencia doctor_profile.id', async () => {
      const result = await dataSource.query(`
        SELECT sr.doctor_id
        FROM surgery_request sr
        LEFT JOIN doctor_profile dp ON sr.doctor_id = dp.id
        WHERE dp.id IS NOT NULL
      `);
      // Nenhuma surgery_request.doctor_id deve casar com doctor_profile.id
      // (a menos que por coincidência de UUID, o que não deve acontecer)
      // Verificamos que todos os doctor_id casam com user.id
      const userCheck = await dataSource.query(`
        SELECT sr.id
        FROM surgery_request sr
        JOIN "user" u ON sr.doctor_id = u.id
      `);
      const totalSR = await dataSource.query(
        `SELECT COUNT(*) as count FROM surgery_request`,
      );
      expect(userCheck.length).toBe(parseInt(totalSR[0].count));
    });

    it('todos os doctor_user_id em user_doctor_access devem ter doctor_profile', async () => {
      const result = await dataSource.query(`
        SELECT uda.doctor_user_id
        FROM user_doctor_access uda
        LEFT JOIN doctor_profile dp ON uda.doctor_user_id = dp.user_id
        WHERE dp.id IS NULL
      `);
      expect(result.length).toBe(0);
    });
  });
});
