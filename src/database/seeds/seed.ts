import * as bcrypt from 'bcryptjs';
import { faker } from '@faker-js/faker';
import { Logger } from '@nestjs/common';
import { SeedDataSource } from '../typeorm/seed-data-source';
import { DEFAULT_PROCEDURE_NAMES } from '../../modules/procedures/default-procedures.constants';
import { seedClinicalReportSections } from './seed-clinical-sections.helper';

const logger = new Logger('Seed');

/**
 * 🌱 SEED v3 — Nova estrutura de usuários e permissões
 *
 * Arquitetura:
 * - role: 'admin' | 'collaborator' (médico = existência de doctor_profile)
 * - owner_id: isolamento de tenant (todos da mesma conta compartilham)
 * - user_doctor_access: controle binário de acesso médico↔usuário
 * - doctor_id em todas as tabelas → user.id
 */

// Verificação de ambiente
function checkEnvironment() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const allowedEnvs = ['development', 'local', 'dev'];

  if (!allowedEnvs.includes(nodeEnv.toLowerCase())) {
    logger.error(
      '❌ ERRO: Seed só pode ser executado em ambiente local ou de desenvolvimento!',
    );
    process.exit(1);
  }
  logger.log(`✅ Ambiente verificado: ${nodeEnv}`);
}

function generateCPF(): string {
  const randomDigits = () => Math.floor(Math.random() * 9);
  let cpf = '';
  for (let i = 0; i < 9; i++) {
    cpf += randomDigits();
  }

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cpf[i]) * (10 - i);
  }
  let digit = 11 - (sum % 11);
  cpf += digit >= 10 ? 0 : digit;

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(cpf[i]) * (11 - i);
  }
  digit = 11 - (sum % 11);
  cpf += digit >= 10 ? 0 : digit;

  return cpf;
}

function generateCNPJ(): string {
  const randomDigits = () => Math.floor(Math.random() * 9);
  let cnpj = '';
  for (let i = 0; i < 12; i++) {
    cnpj += randomDigits();
  }

  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(cnpj[i]) * weights1[i];
  }
  let digit = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  cnpj += digit;

  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += parseInt(cnpj[i]) * weights2[i];
  }
  digit = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  cnpj += digit;

  return cnpj;
}

/**
 * Registra uma transição de status como atividade do tipo `status_change`.
 * Auditoria de status vive em `surgery_request_activities` — não há mais
 * tabela `status_update`.
 */
async function recordStatusChange(
  ds: { query: (q: string, params?: unknown[]) => Promise<unknown[]> },
  surgeryRequestId: string,
  prevStatus: number,
  newStatus: number,
  userId: string | null = null,
): Promise<void> {
  await ds.query(
    `INSERT INTO surgery_request_activities (surgery_request_id, user_id, type, content)
     VALUES ($1, $2, 'status_change', format('Status alterado de %s para %s', $3::int, $4::int))`,
    [surgeryRequestId, userId, prevStatus, newStatus],
  );
}

/**
 * Cria uma subscription ATIVA (já saída do trial) para um admin de seed,
 * com período corrente de 30 dias e quota period vinculado. Não cria
 * payment_method nem invoice (seed é para desenvolvimento — fluxo real
 * exige cadastro de cartão via Stripe).
 */
async function createActiveSubscription(
  dataSource: { query: (q: string, params?: unknown[]) => Promise<unknown[]> },
  ownerId: string,
  planId: string,
): Promise<void> {
  const sub = (await dataSource.query(
    `INSERT INTO subscriptions
       (owner_id, plan_id, status, current_period_start, current_period_end, gateway_provider)
     VALUES
       ($1, $2, 'active', NOW(), NOW() + INTERVAL '30 days', 'stripe')
     RETURNING id`,
    [ownerId, planId],
  )) as Array<{ id: string }>;
  await dataSource.query(
    `INSERT INTO subscription_quota_periods
       (subscription_id, period_start, period_end, surgery_requests_limit, surgery_requests_used)
     SELECT s.id, s.current_period_start, s.current_period_end, p.surgery_request_quota, 0
     FROM subscriptions s INNER JOIN subscription_plans p ON p.id = s.plan_id
     WHERE s.id = $1`,
    [sub[0].id],
  );
}

function generatePhone(): string {
  const ddd = faker.helpers.arrayElement([
    '11',
    '21',
    '31',
    '41',
    '51',
    '61',
    '71',
    '81',
    '85',
  ]);
  const number = `9${faker.string.numeric(8)}`;
  return `${ddd}${number}`;
}

type ManufacturersByOwner = Map<string, Map<string, string>>;

function getDefaultManufacturerId(
  byOwner: ManufacturersByOwner,
  ownerId: string,
): string | null {
  const byName = byOwner.get(ownerId);
  if (!byName?.size) return null;
  return byName.values().next().value ?? null;
}

async function linkOpmeManufacturers(
  dataSource: { query: (q: string, params?: unknown[]) => Promise<unknown[]> },
  byOwner: ManufacturersByOwner,
): Promise<number> {
  const rows = (await dataSource.query(`
    SELECT oi.id, sr.owner_id
    FROM opme_items oi
    INNER JOIN surgery_requests sr ON sr.id = oi.surgery_request_id
    WHERE NOT EXISTS (
      SELECT 1 FROM opme_item_manufacturers oim WHERE oim.opme_item_id = oi.id
    )
  `)) as Array<{ id: string; owner_id: string }>;

  let linked = 0;
  for (const row of rows) {
    const manufacturerId = getDefaultManufacturerId(byOwner, row.owner_id);
    if (!manufacturerId) continue;

    await dataSource.query(
      `INSERT INTO opme_item_manufacturers (opme_item_id, manufacturer_id) VALUES ($1, $2)`,
      [row.id, manufacturerId],
    );
    linked++;
  }

  return linked;
}

async function createDefaultProceduresForOwner(
  dataSource: { query: (q: string, params?: unknown[]) => Promise<any[]> },
  ownerId: string,
): Promise<string[]> {
  const ids: string[] = [];
  for (const name of DEFAULT_PROCEDURE_NAMES) {
    const result = await dataSource.query(
      `INSERT INTO procedures (name, owner_id) VALUES ($1, $2) RETURNING id`,
      [name, ownerId],
    );
    ids.push(result[0].id);
  }
  return ids;
}

async function main() {
  checkEnvironment();

  logger.log('🌱 Iniciando seed do banco de dados (v4 — Dados Completos)...');
  logger.log('⏳ Este processo pode levar alguns minutos...\n');

  const dataSource = await SeedDataSource.initialize();

  // ========================================
  // VERIFICAÇÃO DE IDEMPOTÊNCIA
  // ========================================
  const existing = await dataSource.query(
    `SELECT id FROM "users" WHERE email = 'medico@inexci.com' LIMIT 1`,
  );
  if (existing.length > 0) {
    logger.warn(
      '⚠️  Seed já foi executado anteriormente. Dados encontrados no banco. Abortando para evitar duplicatas.',
    );
    logger.warn(
      '   Se deseja recriar os dados, dropar e recriar o banco antes (migrations + seed).',
    );
    await dataSource.destroy();
    process.exit(0);
  }

  const hashedPassword = await bcrypt.hash('Teste123@', 10);

  // ========================================
  // 1. PLANOS DE ASSINATURA
  // ========================================
  // Cria os planos default (idempotente via ON CONFLICT em slug).
  // Quota é por solicitações cirúrgicas enviadas/mês (-1 = ilimitado).
  logger.log('📋 Criando planos de assinatura...');

  await dataSource.query(`
    INSERT INTO subscription_plans
      (slug, name, description, price_cents, currency, billing_period, surgery_request_quota, gateway_price_id, is_active, is_trial_default, sort_order)
    VALUES
      ('starter',             'Starter',             'Ideal para médicos individuais começando agora',             45800,   'BRL', 'MONTHLY',  10, NULL, true,  true,  1),
      ('starter-anual',       'Starter Anual',       'Ideal para médicos individuais começando agora',             444000,  'BRL', 'YEARLY',   10, NULL, true,  false, 2),
      ('essencial',           'Essencial',           'Para clínicas pequenas e equipes em crescimento',            63400,   'BRL', 'MONTHLY',  20, NULL, true,  false, 3),
      ('essencial-anual',     'Essencial Anual',     'Para clínicas pequenas e equipes em crescimento',            655200,  'BRL', 'YEARLY',   20, NULL, true,  false, 4),
      ('profissional',        'Profissional',        'Para clínicas estabelecidas com alto volume cirúrgico',      81000,   'BRL', 'MONTHLY',  40, NULL, true,  false, 5),
      ('profissional-anual',  'Profissional Anual',  'Para clínicas estabelecidas com alto volume cirúrgico',      866400,  'BRL', 'YEARLY',   40, NULL, true,  false, 6),
      ('avancado',            'Avançado',            'Para grandes equipes com volume intenso de procedimentos',   98600,   'BRL', 'MONTHLY',  50, NULL, true,  false, 7),
      ('avancado-anual',      'Avançado Anual',      'Para grandes equipes com volume intenso de procedimentos',   1077600, 'BRL', 'YEARLY',   50, NULL, true,  false, 8),
      ('enterprise',          'Enterprise',          'Acima de 50 solicitações por mês — vamos conversar',        0,       'BRL', 'MONTHLY',  -1, NULL, true,  false, 9)
    ON CONFLICT (slug) DO NOTHING;
  `);

  // Popula gateway_price_id a partir das vars de ambiente (idempotente)
  const priceMap: Record<string, string | undefined> = {
    starter: process.env.STRIPE_PRICE_STARTER_MONTHLY,
    'starter-anual': process.env.STRIPE_PRICE_STARTER_YEARLY,
    essencial: process.env.STRIPE_PRICE_ESSENCIAL_MONTHLY,
    'essencial-anual': process.env.STRIPE_PRICE_ESSENCIAL_YEARLY,
    profissional: process.env.STRIPE_PRICE_PROFISSIONAL_MONTHLY,
    'profissional-anual': process.env.STRIPE_PRICE_PROFISSIONAL_YEARLY,
    avancado: process.env.STRIPE_PRICE_AVANCADO_MONTHLY,
    'avancado-anual': process.env.STRIPE_PRICE_AVANCADO_YEARLY,
  };
  let priceIdsSet = 0;
  for (const [slug, priceId] of Object.entries(priceMap)) {
    if (!priceId) continue;
    const result = await dataSource.query(
      `UPDATE subscription_plans SET gateway_price_id = $1, updated_at = now()
       WHERE slug = $2 AND (gateway_price_id IS NULL OR gateway_price_id != $1)`,
      [priceId, slug],
    );
    if ((result as any).rowCount > 0) priceIdsSet++;
  }
  if (priceIdsSet > 0) {
    logger.log(
      `  ↳ ${priceIdsSet} gateway_price_id(s) atualizados via STRIPE_PRICE_*`,
    );
  }

  const profPlanRow = await dataSource.query(
    `SELECT id FROM subscription_plans WHERE slug = 'profissional' LIMIT 1`,
  );
  if (!profPlanRow.length) {
    logger.error('Plano "profissional" não encontrado após inserção.');
    process.exit(1);
  }
  const professionalPlanId = profPlanRow[0].id;
  logger.log(
    '✅ 9 planos criados: starter, starter-anual, essencial, essencial-anual, profissional, profissional-anual, avancado, avancado-anual, enterprise\n',
  );

  // ========================================
  // 2. PROCEDIMENTOS (TUSS / cirúrgicos)
  // ========================================
  logger.log('🔧 Preparando procedimentos padrão por conta...');
  const procedureNames = DEFAULT_PROCEDURE_NAMES;

  // ========================================
  // 3. CONTA 1 — Dr. Carlos Mendonça (Admin + Médico)
  //    medico@inexci.com — ortopedista, admin
  // ========================================
  logger.log('👤 Criando conta 1: medico@inexci.com (admin + médico)...');

  const preGen1 = await dataSource.query(`SELECT uuid_generate_v4() AS id`);
  const adminMedicoId = preGen1[0].id;

  await dataSource.query(
    `INSERT INTO "users" (id, name, email, password, phone, cpf, gender, birth_date, role, status, owner_id, admin_id, email_verified, email_verified_at, privacy_policy_accepted_at, terms_of_use_accepted_at, ai_consent_accepted_at)
     VALUES ($1,'Dr. Carlos Mendonça','medico@inexci.com',$2,'11987654321','${generateCPF()}','M','1972-04-10','admin','active',$1,NULL,true,NOW(),NOW(),NOW(),NOW())`,
    [adminMedicoId, hashedPassword],
  );
  await dataSource.query(
    `INSERT INTO doctor_profiles (user_id, crm, crm_state, specialty, clinic_name, clinic_cnpj, clinic_address)
     VALUES ($1,'145632','SP','Ortopedia e Traumatologia','Clínica Ortopédica Mendonça','${generateCNPJ()}','Av. Paulista, 1500 - Bela Vista - São Paulo, SP - CEP 01310-100')`,
    [adminMedicoId],
  );
  await createActiveSubscription(dataSource, adminMedicoId, professionalPlanId);
  // Admin de PLATAFORMA (V2) — único a acessar `/admin/*`. Setado só via seed.
  await dataSource.query(
    `UPDATE "users" SET is_platform_admin = true WHERE id = $1`,
    [adminMedicoId],
  );
  logger.log('  ✅ medico@inexci.com criado (admin + médico, Ortopedia)\n');

  const procedureIdsConta1 = await createDefaultProceduresForOwner(
    dataSource,
    adminMedicoId,
  );
  logger.log(
    `✅ Procedimentos criados para a conta: ${procedureIdsConta1.length}\n`,
  );

  // ========================================
  // 8. HOSPITAIS
  // ========================================
  logger.log('🏥 Criando hospitais...');

  // Hospitais pertencem à clínica (tenant), via owner_id. Todos são da
  // conta 1 (owner = adminMedicoId). Qualquer médico/colaborador da mesma
  // conta pode usá-los nas solicitações cirúrgicas.
  const hospitalsData = [
    // Conta 1 (medico@inexci.com)
    {
      name: 'Hospital Albert Einstein',
      cnpj: generateCNPJ(),
      city: 'São Paulo',
      state: 'SP',
      zip_code: '05652-900',
      address: 'Av. Albert Einstein',
      address_number: '627',
      neighborhood: 'Morumbi',
      phone: '1121511233',
      contact_name: 'Marcos Vieira',
      contact_phone: '11998765432',
      contact_email: 'autorizacoes@einstein.br',
      owner_id: adminMedicoId,
    },
    {
      name: 'Hospital Sírio-Libanês',
      cnpj: generateCNPJ(),
      city: 'São Paulo',
      state: 'SP',
      zip_code: '01308-050',
      address: 'Rua Dona Adma Jafet',
      address_number: '91',
      neighborhood: 'Bela Vista',
      phone: '1131550200',
      contact_name: 'Denise Castro',
      contact_phone: '11997654321',
      contact_email: 'autorizacoes@hsl.org.br',
      owner_id: adminMedicoId,
    },
  ];

  const hospitalIds: string[] = [];
  for (const h of hospitalsData) {
    const r = await dataSource.query(
      `INSERT INTO hospitals (name, cnpj, email, phone, contact_name, contact_phone, contact_email, zip_code, address, address_number, neighborhood, city, state, active, owner_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14) RETURNING id`,
      [
        h.name,
        h.cnpj,
        `contato@${h.name.toLowerCase().replace(/\s/g, '')}${faker.string.numeric(2)}.com.br`,
        h.phone,
        h.contact_name,
        h.contact_phone,
        h.contact_email,
        h.zip_code,
        h.address,
        h.address_number,
        h.neighborhood,
        h.city,
        h.state,
        h.owner_id,
      ],
    );
    hospitalIds.push(r[0].id);
  }
  logger.log(`  ✅ ${hospitalIds.length} hospitais criados\n`);

  // ========================================
  // 9. CONVÊNIOS
  // ========================================
  logger.log('💳 Criando convênios...');

  // Convênios pertencem à clínica (tenant), via owner_id. Todos são da
  // conta 1 (owner = adminMedicoId).
  const healthPlansData = [
    // Conta 1
    {
      name: 'Unimed Paulistana',
      ans_code: '317497',
      phone: '1130030300',
      auth_phone: '1130030301',
      auth_email: 'autorizacoes@unimedpaulistana.com.br',
      website: 'https://www.unimedpaulistana.com.br',
      default_payment_days: 30,
      owner_id: adminMedicoId,
    },
    {
      name: 'Porto Seguro Saúde',
      ans_code: '393321',
      phone: '1130033030',
      auth_phone: '1130033031',
      auth_email: 'autorizacoes@portoseguro.com.br',
      website: 'https://portoseguro.com.br/saude',
      default_payment_days: 28,
      owner_id: adminMedicoId,
    },
    {
      name: 'Hapvida',
      ans_code: '368253',
      phone: '8532570100',
      auth_phone: '8532570101',
      auth_email: 'autorizacoes@hapvida.com.br',
      website: 'https://www.hapvida.com.br',
      default_payment_days: 25,
      owner_id: adminMedicoId,
    },
  ];

  const healthPlanIds: string[] = [];
  for (const hp of healthPlansData) {
    const r = await dataSource.query(
      `INSERT INTO health_plans (name, ans_code, cnpj, email, phone, authorization_contact, authorization_phone, authorization_email, website, default_payment_days, active, owner_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11) RETURNING id`,
      [
        hp.name,
        hp.ans_code,
        generateCNPJ(),
        `contato@${hp.name.toLowerCase().replace(/\s/g, '')}${faker.string.numeric(2)}.com.br`,
        hp.phone,
        'Central de Autorizações',
        hp.auth_phone,
        hp.auth_email,
        hp.website,
        hp.default_payment_days,
        hp.owner_id,
      ],
    );
    healthPlanIds.push(r[0].id);
  }
  logger.log(`  ✅ ${healthPlanIds.length} convênios criados\n`);

  // ========================================
  // 10. FORNECEDORES DE OPME
  // ========================================
  logger.log('📦 Criando fornecedores...');

  // Fornecedores pertencem à clínica (tenant), via owner_id. Todos são da
  // conta 1 (owner = adminMedicoId).
  const suppliersData = [
    // Conta 1
    {
      name: 'Zimmer Biomet Brasil',
      contact_name: 'Claudia Neves',
      contact_phone: '11997001234',
      contact_email: 'claudia@zimmerbiomet.com.br',
      city: 'São Paulo',
      state: 'SP',
      owner_id: adminMedicoId,
    },
    {
      name: 'DePuy Synthes',
      contact_name: 'Fernando Costa',
      contact_phone: '11996005678',
      contact_email: 'fernando@depuy.com.br',
      city: 'São Paulo',
      state: 'SP',
      owner_id: adminMedicoId,
    },
  ];

  const supplierIds: string[] = [];
  for (const s of suppliersData) {
    const r = await dataSource.query(
      `INSERT INTO suppliers (name, cnpj, email, phone, contact_name, contact_phone, contact_email, city, state, owner_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        s.name,
        generateCNPJ(),
        `vendas@${s.name.toLowerCase().replace(/\s/g, '')}${faker.string.numeric(2)}.com.br`,
        generatePhone(),
        s.contact_name,
        s.contact_phone,
        s.contact_email,
        s.city,
        s.state,
        s.owner_id,
      ],
    );
    supplierIds.push(r[0].id);
  }
  logger.log(`  ✅ ${supplierIds.length} fornecedores criados\n`);

  // ========================================
  // 10.1 FABRICANTES DE OPME
  // ========================================
  logger.log('🏭 Criando fabricantes...');

  const manufacturersData = [
    // Conta 1
    {
      name: 'Zimmer Biomet',
      owner_id: adminMedicoId,
      website: 'https://www.zimmerbiomet.com',
      country: 'Brasil',
      contact_name: 'Claudia Neves',
      contact_phone: '11997001234',
      contact_email: 'claudia@zimmerbiomet.com.br',
    },
    {
      name: 'DePuy Synthes',
      owner_id: adminMedicoId,
      website: 'https://www.jnjmedtech.com',
      country: 'Brasil',
      contact_name: 'Fernando Costa',
      contact_phone: '11996005678',
      contact_email: 'fernando@depuy.com.br',
    },
    {
      name: 'Alcon',
      owner_id: adminMedicoId,
      website: 'https://www.alcon.com',
      country: 'Brasil',
      contact_name: 'Equipe Comercial Alcon',
      contact_phone: generatePhone(),
      contact_email: `comercial.alcon.${faker.string.numeric(4)}@example.com`,
    },
  ];

  const manufacturersByOwner: ManufacturersByOwner = new Map();
  const manufacturerIds: string[] = [];
  for (const m of manufacturersData) {
    const r = await dataSource.query(
      `INSERT INTO manufacturers (name, cnpj, anvisa_registration, email, phone, website, country, contact_name, contact_phone, contact_email, notes, owner_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        m.name,
        generateCNPJ(),
        `ANV-${faker.string.numeric(8)}`,
        `contato@${m.name.toLowerCase().replace(/[^a-z0-9]/g, '')}${faker.string.numeric(2)}.com.br`,
        generatePhone(),
        m.website,
        m.country,
        m.contact_name,
        m.contact_phone,
        m.contact_email,
        'Fabricante cadastrado para ambiente de desenvolvimento.',
        m.owner_id,
      ],
    );
    const manufacturerId = r[0].id as string;
    manufacturerIds.push(manufacturerId);

    if (!manufacturersByOwner.has(m.owner_id)) {
      manufacturersByOwner.set(m.owner_id, new Map());
    }
    manufacturersByOwner.get(m.owner_id)!.set(m.name, manufacturerId);
  }
  logger.log(`  ✅ ${manufacturerIds.length} fabricantes criados\n`);

  // ========================================
  // 12. PACIENTES — Conta 1 (medico@inexci.com)
  // ========================================
  logger.log('🧑‍🤝‍🧑 Criando pacientes da conta 1...');

  const patientsData1 = [
    {
      name: 'Fernando Augusto Costa',
      email: 'fernando.costa@gmail.com',
      gender: 'M',
      birth: '1960-08-12',
      cpf: generateCPF(),
      phone: '11998001111',
      zip_code: '05652-900',
      address: 'Av. Albert Einstein',
      address_number: '50',
      neighborhood: 'Morumbi',
      city: 'São Paulo',
      state: 'SP',
      hp_idx: 0,
      hp_number: '1122334455',
      hp_type: 'Apartamento',
      notes:
        'Artrose avançada bilateral de joelhos. Indicação de ATJ bilateral.',
    },
    {
      name: 'Beatriz Helena Santos',
      email: 'beatriz.santos@hotmail.com',
      gender: 'F',
      birth: '1955-01-30',
      cpf: generateCPF(),
      phone: '11987002222',
      zip_code: '01308-050',
      address: 'Rua Dona Adma Jafet',
      address_number: '80',
      neighborhood: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
      hp_idx: 1,
      hp_number: '9988776655',
      hp_type: 'Apartamento Superior',
      notes: 'Fratura de quadril após queda. Indicação urgente de ATQ.',
    },
    {
      name: 'Marcos Antônio Ribeiro',
      email: 'marcos.ribeiro@yahoo.com.br',
      gender: 'M',
      birth: '1978-05-19',
      cpf: generateCPF(),
      phone: '11976003333',
      zip_code: '04547-006',
      address: 'Av. Brigadeiro Faria Lima',
      address_number: '3900',
      neighborhood: 'Itaim Bibi',
      city: 'São Paulo',
      state: 'SP',
      hp_idx: 0,
      hp_number: '4433221100',
      hp_type: 'Enfermaria',
      notes: null,
    },
    {
      name: 'Patrícia Gonçalves Ferraz',
      email: 'patricia.ferraz@gmail.com',
      gender: 'F',
      birth: '1988-10-07',
      cpf: generateCPF(),
      phone: '11965004444',
      zip_code: '01310-100',
      address: 'Av. Paulista',
      address_number: '900',
      neighborhood: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
      hp_idx: 2,
      hp_number: '7766554433',
      hp_type: 'Apartamento',
      notes: 'Lesão meniscal medial direita. Praticante de corrida.',
    },
    {
      name: 'Eduardo Luiz Teixeira',
      email: 'eduardo.teixeira@terra.com.br',
      gender: 'M',
      birth: '1945-03-03',
      cpf: generateCPF(),
      phone: '11954005555',
      zip_code: '05653-000',
      address: 'Rua Iguatemi',
      address_number: '192',
      neighborhood: 'Itaim Bibi',
      city: 'São Paulo',
      state: 'SP',
      hp_idx: 0,
      hp_number: '2211009988',
      hp_type: 'Apartamento',
      notes:
        'Osteoporose severa. Uso de bifosfonatos há 5 anos. Necessita avaliação pré-operatória detalhada.',
    },
  ];

  const patientIds1: string[] = [];
  for (const p of patientsData1) {
    const hpId = healthPlanIds[p.hp_idx];
    const r = await dataSource.query(
      `INSERT INTO patients (doctor_id, owner_id, name, email, phone, cpf, gender, birth_date, health_plan_id, health_plan_number, health_plan_type, zip_code, address, address_number, neighborhood, city, state, medical_notes, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,true) RETURNING id`,
      [
        adminMedicoId,
        adminMedicoId,
        p.name,
        p.email,
        p.phone,
        p.cpf,
        p.gender,
        p.birth,
        hpId,
        p.hp_number,
        p.hp_type,
        p.zip_code,
        p.address,
        p.address_number,
        p.neighborhood,
        p.city,
        p.state,
        p.notes,
      ],
    );
    patientIds1.push(r[0].id);
  }
  logger.log(`  ✅ ${patientIds1.length} pacientes criados para conta 1\n`);

  // ========================================
  // 14. SOLICITAÇÕES CIRÚRGICAS — Conta 1 (medico@inexci.com)
  // ========================================
  logger.log('📋 Criando solicitações cirúrgicas (conta 1)...');

  const srIds1: string[] = [];

  // SR C1-1 — ATJ — SCHEDULED
  {
    const surgDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, health_plan_registration, health_plan_type, sent_at, analysis_started_at, health_plan_protocol, surgery_date, hospital_protocol)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,5,3,true,$7,$8,NOW() - INTERVAL '30 days',NOW() - INTERVAL '27 days','UNIMED-20241087',$9,'HEIN-2024-5531') RETURNING id`,
      [
        adminMedicoId,
        adminMedicoId,
        patientIds1[0],
        hospitalIds[0],
        healthPlanIds[0],
        procedureIdsConta1[4],
        '1122334455',
        'Apartamento',
        surgDate,
      ],
    );
    srIds1.push(r[0].id);
    await seedClinicalReportSections(dataSource, r[0].id, {
      diagnosis:
        'Gonartrose bilateral grau IV (KL). Dor intensa e incapacitante bilateral. Sem resposta a tratamento clínico e infiltrações.',
      medicalReport:
        'Paciente 64 anos com artrose avançada dos joelhos. Cintilografia óssea com hipercaptação bilateral. Indicação absoluta de ATJ.',
      patientHistory:
        'HAS, DM2. Risco cirúrgico baixo (cardiologista). IMC 28. Sem antecedentes de TVP.',
      surgeryDescription:
        'Artroplastia total do joelho direito com prótese de superfície cimentada. Uso de torniquete, acesso medial parapatelar.',
    });
    for (const [p, n] of [
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ])
      await recordStatusChange(dataSource, r[0].id, p, n);
    const opmeC1a = await dataSource.query(
      `INSERT INTO opme_items (surgery_request_id, name, quantity, authorized_quantity) VALUES ($1,'Prótese total de joelho Triathlon - tamanho 5',1,1) RETURNING id`,
      [r[0].id],
    );
    await dataSource.query(
      `INSERT INTO opme_item_suppliers (opme_item_id, supplier_id) VALUES ($1,$2)`,
      [opmeC1a[0].id, supplierIds[0]],
    );
    const opmeC1b = await dataSource.query(
      `INSERT INTO opme_items (surgery_request_id, name, quantity, authorized_quantity) VALUES ($1,'Polia tibial ultracongruente',1,1) RETURNING id`,
      [r[0].id],
    );
    await dataSource.query(
      `INSERT INTO opme_item_suppliers (opme_item_id, supplier_id) VALUES ($1,$2)`,
      [opmeC1b[0].id, supplierIds[0]],
    );
    const opmeC1c = await dataSource.query(
      `INSERT INTO opme_items (surgery_request_id, name, quantity, authorized_quantity) VALUES ($1,'Cimento ósseo com antibiótico 40g',2,2) RETURNING id`,
      [r[0].id],
    );
    await dataSource.query(
      `INSERT INTO opme_item_suppliers (opme_item_id, supplier_id) VALUES ($1,$2)`,
      [opmeC1c[0].id, supplierIds[1]],
    );
    await dataSource.query(
      `INSERT INTO surgery_request_quotations (surgery_request_id, supplier_id, proposal_number, total_value, submission_date, valid_until, selected)
       VALUES ($1,$2,'COT-ZIM-2024-221',21500.00,NOW() - INTERVAL '22 days',NOW() + INTERVAL '8 days',true)`,
      [r[0].id, supplierIds[0]],
    );
    await dataSource.query(
      `INSERT INTO surgery_request_quotations (surgery_request_id, supplier_id, proposal_number, total_value, submission_date, valid_until, selected)
       VALUES ($1,$2,'COT-DEP-2024-445',23200.00,NOW() - INTERVAL '20 days',NOW() + INTERVAL '10 days',false)`,
      [r[0].id, supplierIds[1]],
    );
  }

  // SR C1-2 — ATQ urgente — IN_SCHEDULING
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, health_plan_registration, health_plan_type, sent_at, analysis_started_at, health_plan_protocol, date_options)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,4,4,true,$7,$8,NOW() - INTERVAL '5 days',NOW() - INTERVAL '3 days','PORTO-20240777',$9) RETURNING id`,
      [
        adminMedicoId,
        adminMedicoId,
        patientIds1[1],
        hospitalIds[0],
        healthPlanIds[1],
        procedureIdsConta1[7],
        '9988776655',
        'Apartamento Superior',
        JSON.stringify(
          (() => {
            const buildSlot = (daysAhead: number, hour: number, minute = 0) => {
              const d = new Date();
              d.setDate(d.getDate() + daysAhead);
              d.setHours(hour, minute, 0, 0);
              return d.toISOString();
            };
            return [
              buildSlot(2, 7, 0),
              buildSlot(3, 7, 0),
              buildSlot(4, 13, 30),
            ];
          })(),
        ),
      ],
    );
    srIds1.push(r[0].id);
    await seedClinicalReportSections(dataSource, r[0].id, {
      diagnosis:
        'Fratura do colo do fêmur direito Garden III em paciente idosa. Queda da própria altura em domicílio.',
      medicalReport:
        'RX confirma fratura do colo femoral direito deslocada. Indicação de tratamento cirúrgico de urgência.',
      patientHistory:
        'Osteoporose severa. HAS. Uso de anticoagulantes (suspenso). Risco cirúrgico moderado (ASA III).',
      surgeryDescription:
        'Artroplastia total do quadril direito cimentada. Via póstero-lateral. Prótese cimentada com cimento antibiótico.',
    });
    for (const [p, n] of [
      [1, 2],
      [2, 3],
      [3, 4],
    ])
      await recordStatusChange(dataSource, r[0].id, p, n);
    const opmeC2a = await dataSource.query(
      `INSERT INTO opme_items (surgery_request_id, name, quantity) VALUES ($1,'Prótese total de quadril cimentada - haste 12',1) RETURNING id`,
      [r[0].id],
    );
    await dataSource.query(
      `INSERT INTO opme_item_suppliers (opme_item_id, supplier_id) VALUES ($1,$2)`,
      [opmeC2a[0].id, supplierIds[1]],
    );
    const opmeC2b = await dataSource.query(
      `INSERT INTO opme_items (surgery_request_id, name, quantity) VALUES ($1,'Cimento ósseo Palacos R 40g',3) RETURNING id`,
      [r[0].id],
    );
    await dataSource.query(
      `INSERT INTO opme_item_suppliers (opme_item_id, supplier_id) VALUES ($1,$2)`,
      [opmeC2b[0].id, supplierIds[1]],
    );
  }

  // SR C1-3 — Artroscopia — PENDING
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, health_plan_registration, health_plan_type)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,1,2,false,$7,$8) RETURNING id`,
      [
        adminMedicoId,
        adminMedicoId,
        patientIds1[3],
        hospitalIds[1],
        healthPlanIds[0],
        procedureIdsConta1[5],
        '7766554433',
        'Apartamento',
      ],
    );
    srIds1.push(r[0].id);
    await seedClinicalReportSections(dataSource, r[0].id, {
      diagnosis:
        'Lesão meniscal medial posterior direita em paciente jovem e ativa. RNM confirma rotura complexa.',
      medicalReport:
        'Paciente com dor medial no joelho após torção durante corrida. RNM: rotura complexa de menisco medial. Bloqueio articular intermitente.',
      patientHistory: 'ASA I. Atleta amadora. Sem comorbidades.',
      surgeryDescription:
        'Artroscopia diagnóstica e terapêutica com meniscectomia parcial ou sutura meniscal conforme avaliação intraoperatória.',
    });
  }

  // SR C1-4 — FINALIZED com billing e contestação
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, health_plan_registration, health_plan_type, sent_at, surgery_performed_at)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,8,2,true,$7,$8,NOW() - INTERVAL '120 days',NOW() - INTERVAL '80 days') RETURNING id`,
      [
        adminMedicoId,
        adminMedicoId,
        patientIds1[2],
        hospitalIds[1],
        healthPlanIds[2],
        procedureIdsConta1[4],
        '4433221100',
        'Enfermaria',
      ],
    );
    srIds1.push(r[0].id);
    await seedClinicalReportSections(dataSource, r[0].id, {
      diagnosis:
        'Gonartrose severa unilateral esquerda com deformidade em varo. Falha do tratamento conservador por 2 anos.',
      medicalReport:
        'Paciente com artrose avançada do joelho esquerdo. Deformidade em varo de 12 graus. RX: pinçamento total.',
      patientHistory: 'Sem comorbidades. ASA I. IMC 23. Bom estado geral.',
      surgeryDescription: 'ATJ esquerda com correção de deformidade em varo.',
    });
    for (const [p, n] of [
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 8],
    ])
      await recordStatusChange(dataSource, r[0].id, p, n);
    const opmeC4a = await dataSource.query(
      `INSERT INTO opme_items (surgery_request_id, name, quantity, authorized_quantity) VALUES ($1,'Prótese total de joelho Persona - tamanho C',1,0) RETURNING id`,
      [r[0].id],
    );
    await dataSource.query(
      `INSERT INTO opme_item_suppliers (opme_item_id, supplier_id) VALUES ($1,$2)`,
      [opmeC4a[0].id, supplierIds[0]],
    );
    await dataSource.query(
      `INSERT INTO surgery_request_billings (surgery_request_id, created_by_id, invoice_protocol, invoice_sent_at, invoice_value, payment_deadline, received_value, received_at, receipt_notes, contested_received_value, contested_received_at, contested_receipt_notes)
       VALUES ($1,$2,'FAT-HAP-2024-00221',NOW() - INTERVAL '70 days',19800.00,NOW() - INTERVAL '40 days',15200.00,NOW() - INTERVAL '42 days','Glosa parcial na OPME.',19800.00,NOW() - INTERVAL '35 days','Contestação enviada com nota fiscal e relatório cirúrgico. Aguardando revisão da operadora.')`,
      [r[0].id, adminMedicoId],
    );
    await dataSource.query(
      `INSERT INTO contestations (surgery_request_id, created_by_id, type, reason) VALUES ($1,$2,'payment','Valor recebido inferior ao faturado. Glosa indevida de R$ 4.600,00 referente ao implante de joelho autorizado previamente.')`,
      [r[0].id, adminMedicoId],
    );
  }

  // SR C1-5 — SENT (Enviada) — Eduardo Luiz Teixeira
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, health_plan_registration, health_plan_type, sent_at, send_method)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,2,2,false,$7,$8,NOW() - INTERVAL '4 days','email') RETURNING id`,
      [
        adminMedicoId,
        adminMedicoId,
        patientIds1[4],
        hospitalIds[0],
        healthPlanIds[0],
        procedureIdsConta1[19],
        '2211009988',
        'Apartamento',
      ],
    );
    srIds1.push(r[0].id);
    await seedClinicalReportSections(dataSource, r[0].id, {
      diagnosis:
        'Espondilolistese degenerativa L4-L5 grau II com estenose foraminal e dor radicular bilateral. Sem resposta ao tratamento conservador por 18 meses.',
      medicalReport:
        'Paciente de 80 anos com lombalgia crônica irradiada para membros inferiores. RM confirma listese e estenose foraminal bilateral grave. Fisioterapia e bloqueio epidural sem resultado.',
      patientHistory:
        'Osteoporose severa. HAS controlada. Uso de bifosfonatos. Risco cirúrgico moderado (ASA III). Avaliação cardiológica favorável ao procedimento.',
      surgeryDescription:
        'Artrodese posterolateral L4-L5 com instrumentação pedicular bilateral e descompressão do canal vertebral.',
    });
    await recordStatusChange(dataSource, r[0].id, 1, 2, adminMedicoId);
  }

  // SR C1-6 — IN_ANALYSIS (Em Análise) — Fernando Augusto Costa (segunda cirurgia)
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, health_plan_registration, health_plan_type, sent_at, analysis_started_at)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,3,2,false,$7,$8,NOW() - INTERVAL '15 days',NOW() - INTERVAL '12 days') RETURNING id`,
      [
        adminMedicoId,
        adminMedicoId,
        patientIds1[0],
        hospitalIds[1],
        healthPlanIds[1],
        procedureIdsConta1[1],
        '1122334455',
        'Apartamento',
      ],
    );
    srIds1.push(r[0].id);
    await seedClinicalReportSections(dataSource, r[0].id, {
      diagnosis:
        'Hérnia inguinal bilateral volumosa com episódios de encarceramento. Indicação cirúrgica de urgência relativa.',
      medicalReport:
        'Paciente com abaulamento inguinal bilateral há 3 anos com progressão nos últimos 6 meses e dois episódios de encarceramento. Exame clínico confirma hérnia inguinal direta bilateral redutível.',
      patientHistory:
        'HAS controlada. DM2 compensada. ASA II. Avaliação pré-operatória em andamento.',
      surgeryDescription:
        'Herniorrafia inguinal bilateral com tela de polipropileno por via aberta (técnica de Lichtenstein bilateral).',
    });
    await recordStatusChange(dataSource, r[0].id, 1, 2, adminMedicoId);
    await recordStatusChange(dataSource, r[0].id, 2, 3, adminMedicoId);
    await dataSource.query(
      `INSERT INTO surgery_request_analyses (surgery_request_id, request_number, received_at, notes)
       VALUES ($1,'PORTO-2024-01834',NOW() - INTERVAL '12 days','Documentação recebida. Aguardando análise técnica do convênio.')`,
      [r[0].id],
    );
  }

  // SR C1-7 — PERFORMED (Realizada) — Beatriz Helena Santos (segunda cirurgia)
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, health_plan_registration, health_plan_type, sent_at, analysis_started_at, health_plan_protocol, surgery_date, surgery_performed_at)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,6,3,true,$7,$8,NOW() - INTERVAL '55 days',NOW() - INTERVAL '52 days','UNIMED-20241243',NOW() - INTERVAL '20 days',NOW() - INTERVAL '20 days') RETURNING id`,
      [
        adminMedicoId,
        adminMedicoId,
        patientIds1[1],
        hospitalIds[0],
        healthPlanIds[0],
        procedureIdsConta1[17],
        '9988776655',
        'Apartamento Superior',
      ],
    );
    srIds1.push(r[0].id);
    for (const [prev, next] of [
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
    ]) {
      await recordStatusChange(dataSource, r[0].id, prev, next, adminMedicoId);
    }
    const opmeC7a = await dataSource.query(
      `INSERT INTO opme_items (surgery_request_id, name, quantity, authorized_quantity) VALUES ($1,'Lente intraocular monofocal AcrySof IQ',1,1) RETURNING id`,
      [r[0].id],
    );
    await dataSource.query(
      `INSERT INTO opme_item_suppliers (opme_item_id, supplier_id) VALUES ($1,$2)`,
      [opmeC7a[0].id, supplierIds[0]],
    );
    await dataSource.query(
      `INSERT INTO report_sections (surgery_request_id, title, description, "order") VALUES ($1, 'Diagnóstico e Indicação', $2, 1)`,
      [
        r[0].id,
        '<p>Catarata nuclear densa grau IV no olho direito. Acuidade visual inferior a 20/200 com piora progressiva nos últimos 6 meses.</p><p>HAS controlada. Osteoporose. Uso de anticoagulantes suspensos 5 dias antes do procedimento. ASA II.</p>',
      ],
    );
    await dataSource.query(
      `INSERT INTO report_sections (surgery_request_id, title, description, "order") VALUES ($1, 'Procedimento Realizado', $2, 2)`,
      [
        r[0].id,
        '<p>Facoemulsificação com implante de LIO monofocal no olho direito. Anestesia tópica com sedação leve.</p><p>Paciente de 70 anos com redução progressiva da acuidade visual. Oftalmoscopia confirma catarata densa bilateral. Facectomia com implante de lente intraocular monofocal realizada sem intercorrências.</p>',
      ],
    );
  }

  // SR C1-8 — INVOICED (Faturada) — Marcos Antônio Ribeiro (segunda cirurgia)
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, health_plan_registration, health_plan_type, sent_at, surgery_performed_at)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,7,1,false,$7,$8,NOW() - INTERVAL '65 days',NOW() - INTERVAL '35 days') RETURNING id`,
      [
        adminMedicoId,
        adminMedicoId,
        patientIds1[2],
        hospitalIds[1],
        healthPlanIds[0],
        procedureIdsConta1[18],
        '4433221100',
        'Enfermaria',
      ],
    );
    srIds1.push(r[0].id);
    await seedClinicalReportSections(dataSource, r[0].id, {
      diagnosis:
        'Desvio septal esquerdo grau III com obstrução nasal crônica e hipertrofia de cornetos inferiores bilaterais.',
      medicalReport:
        'Paciente com obstrução nasal crônica bilateral predominante à esquerda há 4 anos. Sem resposta a corticosteroides tópicos por 6 meses. Desvio septal confirmado por rinoscopia.',
      patientHistory:
        'Sem comorbidades. ASA I. Exames pré-operatórios normais.',
      surgeryDescription:
        'Rinoplastia funcional com septoplastia e turbinoplastia por redução. Anestesia geral.',
    });
    for (const [prev, next] of [
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
    ]) {
      await recordStatusChange(dataSource, r[0].id, prev, next, adminMedicoId);
    }
    await dataSource.query(
      `INSERT INTO surgery_request_billings (surgery_request_id, created_by_id, invoice_protocol, invoice_sent_at, invoice_value, payment_deadline)
       VALUES ($1,$2,'FAT-UNP-2024-00512',NOW() - INTERVAL '12 days',3200.00,NOW() + INTERVAL '18 days')`,
      [r[0].id, adminMedicoId],
    );
  }

  // SR C1-9 — CLOSED (Encerrada) — Patrícia Gonçalves Ferraz (segunda solicitação)
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, health_plan_registration, health_plan_type, sent_at, closed_reason, closed_at)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,9,2,false,$7,$8,NOW() - INTERVAL '35 days','Convênio negou autorização por carência contratual do plano. Paciente optou por reagendamento após período de carência.',NOW() - INTERVAL '10 days') RETURNING id`,
      [
        adminMedicoId,
        adminMedicoId,
        patientIds1[3],
        hospitalIds[1],
        healthPlanIds[2],
        procedureIdsConta1[10],
        '7766554433',
        'Apartamento',
      ],
    );
    srIds1.push(r[0].id);
    await seedClinicalReportSections(dataSource, r[0].id, {
      diagnosis:
        'Nódulo tireoidiano sólido de 2,8 cm com PAAF indeterminada (Bethesda IV). Indicação de tireoidectomia total para diagnóstico definitivo e tratamento.',
      medicalReport:
        'Paciente com nódulo tireoidiano palpável identificado há 6 meses. USG confirma nódulo sólido hipoecogênico de 2,8 cm. PAAF: neoplasia folicular (Bethesda IV).',
      patientHistory:
        'Sem comorbidades. ASA I. Avaliação laringoscópica normal.',
      surgeryDescription:
        'Tireoidectomia total com linfadenectomia do compartimento central por cervicotomia.',
    });
    await recordStatusChange(dataSource, r[0].id, 1, 2, adminMedicoId);
    await recordStatusChange(dataSource, r[0].id, 2, 9, adminMedicoId);
  }

  logger.log(`  ✅ ${srIds1.length} solicitações criadas para conta 1\n`);

  // ========================================
  // 14a. COMPLETUDE DAS SCs (TUSS + OPME + Laudo)
  // ========================================
  logger.log('🧩 Garantindo completude das solicitações cirúrgicas...');

  const allSurgeryRequests: {
    id: string;
    owner_id: string;
    procedure_name: string | null;
  }[] = await dataSource.query(
    `SELECT sr.id, sr.owner_id, p.name AS procedure_name
     FROM surgery_requests sr
     LEFT JOIN procedures p ON p.id = sr.procedure_id`,
  );

  const suppliersByOwner: { owner_id: string; id: string }[] =
    await dataSource.query(
      `SELECT id, owner_id
       FROM suppliers
       ORDER BY created_at ASC`,
    );

  const defaultSupplierByOwner = new Map<string, string>();
  for (const s of suppliersByOwner) {
    if (!defaultSupplierByOwner.has(s.owner_id)) {
      defaultSupplierByOwner.set(s.owner_id, s.id);
    }
  }

  let addedTuss = 0;
  let addedOpme = 0;
  let addedReportSections = 0;

  for (let i = 0; i < allSurgeryRequests.length; i++) {
    const sr = allSurgeryRequests[i];
    const procedureName = sr.procedure_name ?? 'Procedimento cirúrgico';

    const tussCountResult = await dataSource.query(
      `SELECT COUNT(*)::int AS count
       FROM surgery_request_tuss_items
       WHERE surgery_request_id = $1`,
      [sr.id],
    );
    const tussCount = tussCountResult?.[0]?.count ?? 0;

    if (tussCount === 0) {
      await dataSource.query(
        `INSERT INTO surgery_request_tuss_items (surgery_request_id, tuss_code, name, quantity, authorized_quantity)
         VALUES ($1, $2, $3, 1, 1)`,
        [sr.id, `SEED-TUSS-${i + 1}`, procedureName],
      );
      addedTuss++;
    }

    const opmeCountResult = await dataSource.query(
      `SELECT COUNT(*)::int AS count
       FROM opme_items
       WHERE surgery_request_id = $1`,
      [sr.id],
    );
    const opmeCount = opmeCountResult?.[0]?.count ?? 0;

    if (opmeCount === 0) {
      const opmeInsert = await dataSource.query(
        `INSERT INTO opme_items (surgery_request_id, name, quantity, authorized_quantity)
         VALUES ($1, $2, 1, 1) RETURNING id`,
        [sr.id, `Kit OPME padrão - ${procedureName}`],
      );

      const supplierId = defaultSupplierByOwner.get(sr.owner_id);
      if (supplierId && opmeInsert?.[0]?.id) {
        await dataSource.query(
          `INSERT INTO opme_item_suppliers (opme_item_id, supplier_id)
           VALUES ($1, $2)`,
          [opmeInsert[0].id, supplierId],
        );
      }

      await dataSource.query(
        `UPDATE surgery_requests
         SET has_opme = true
         WHERE id = $1`,
        [sr.id],
      );

      addedOpme++;
    }

    const reportSectionsCountResult = await dataSource.query(
      `SELECT COUNT(*)::int AS count
       FROM report_sections
       WHERE surgery_request_id = $1`,
      [sr.id],
    );
    const reportSectionsCount = reportSectionsCountResult?.[0]?.count ?? 0;

    if (reportSectionsCount === 0) {
      await dataSource.query(
        `INSERT INTO report_sections (surgery_request_id, title, description, "order")
         VALUES ($1, 'Histórico e Diagnóstico', $2, 1)`,
        [
          sr.id,
          `<p>Paciente em acompanhamento para <strong>${procedureName}</strong>, com indicação cirúrgica baseada em avaliação clínica e exames complementares.</p>`,
        ],
      );

      await dataSource.query(
        `INSERT INTO report_sections (surgery_request_id, title, description, "order")
         VALUES ($1, 'Conduta', $2, 2)`,
        [
          sr.id,
          `<p>Conduta proposta: realização de <strong>${procedureName}</strong>, com preparo pré-operatório, documentação assistencial e acompanhamento pós-operatório conforme protocolo institucional.</p>`,
        ],
      );

      addedReportSections += 2;
    }
  }

  logger.log(
    `  ✅ Completude aplicada: ${addedTuss} TUSS, ${addedOpme} OPMEs e ${addedReportSections} seções de laudo adicionadas\n`,
  );

  // ========================================
  // 14b. VÍNCULO OPME ↔ FABRICANTE
  // ========================================
  logger.log('🔗 Vinculando fabricantes aos itens OPME...');
  const linkedOpmeManufacturers = await linkOpmeManufacturers(
    dataSource,
    manufacturersByOwner,
  );
  logger.log(
    `  ✅ ${linkedOpmeManufacturers} vínculos em opme_item_manufacturers criados\n`,
  );

  // ========================================
  // 15. CID/TUSS
  // ========================================
  logger.log(
    '⏭️ Carga de CID/TUSS e vinculação nas solicitações foi removida do seed (será feita manualmente).\n',
  );

  // ========================================
  // 15a. TEMPLATES DE SOLICITAÇÃO
  // ========================================
  logger.log('📝 Criando templates de solicitação...');

  await dataSource.query(
    `INSERT INTO surgery_request_templates (doctor_id, owner_id, name, template_data, usage_count) VALUES ($1, (SELECT owner_id FROM users WHERE id = $1), $2, $3, $4)`,
    [
      adminMedicoId,
      'ATJ Padrão',
      JSON.stringify({
        procedureId: procedureIdsConta1[4],
        procedure: { id: procedureIdsConta1[4], name: procedureNames[4] },
        procedureName: procedureNames[4],
        opmeItems: [
          {
            name: 'Prótese total de joelho cimentada',
            manufacturers: ['Stryker Triathlon'],
            quantity: 1,
          },
          {
            name: 'Cimento ósseo com antibiótico 40g',
            manufacturers: ['Palacos'],
            quantity: 2,
          },
        ],
        requiredDocuments: [
          'personal_document',
          'doctor_request',
          'medical_report',
          'preoperative_exams',
        ],
        requiredExams: [
          'Hemograma',
          'Coagulograma',
          'RX joelho AP/P',
          'Risco cirúrgico',
        ],
      }),
      8,
    ],
  );
  await dataSource.query(
    `INSERT INTO surgery_request_templates (doctor_id, owner_id, name, template_data, usage_count) VALUES ($1, (SELECT owner_id FROM users WHERE id = $1), $2, $3, $4)`,
    [
      adminMedicoId,
      'Artroscopia de Joelho',
      JSON.stringify({
        procedureId: procedureIdsConta1[5],
        procedure: { id: procedureIdsConta1[5], name: procedureNames[5] },
        procedureName: procedureNames[5],
        opmeItems: [],
        requiredDocuments: [
          'personal_document',
          'doctor_request',
          'medical_report',
        ],
        requiredExams: ['RNM joelho', 'Hemograma', 'Coagulograma'],
      }),
      3,
    ],
  );

  logger.log('  ✅ 2 templates criados\n');

  // ========================================
  // 15f. ATIVIDADES nas solicitações
  // ========================================
  logger.log('📊 Criando atividades nas solicitações...');

  // SR C1-1 — atividades diversas
  await dataSource.query(
    `INSERT INTO surgery_request_activities (surgery_request_id, user_id, type, content) VALUES ($1, $2, 'status_change', 'Status alterado de Pendente para Enviada')`,
    [srIds1[0], adminMedicoId],
  );
  await dataSource.query(
    `INSERT INTO surgery_request_activities (surgery_request_id, user_id, type, content) VALUES ($1, $2, 'comment', 'Paciente confirmou disponibilidade para cirurgia na data proposta. Exames pré-operatórios em dia.')`,
    [srIds1[0], adminMedicoId],
  );
  await dataSource.query(
    `INSERT INTO surgery_request_activities (surgery_request_id, user_id, type, content) VALUES ($1, $2, 'system', 'PDF da solicitação gerado e enviado para o convênio via e-mail.')`,
    [srIds1[0], adminMedicoId],
  );
  await dataSource.query(
    `INSERT INTO surgery_request_activities (surgery_request_id, user_id, type, content) VALUES ($1, $2, 'status_change', 'Status alterado de Enviada para Em Análise')`,
    [srIds1[0], adminMedicoId],
  );
  await dataSource.query(
    `INSERT INTO surgery_request_activities (surgery_request_id, user_id, type, content) VALUES ($1, $2, 'status_change', 'Status alterado de Em Análise para Em Agendamento')`,
    [srIds1[0], adminMedicoId],
  );
  await dataSource.query(
    `INSERT INTO surgery_request_activities (surgery_request_id, user_id, type, content) VALUES ($1, $2, 'comment', 'Cotação da Zimmer Biomet selecionada. Valor: R$ 21.500,00.')`,
    [srIds1[0], adminMedicoId],
  );
  await dataSource.query(
    `INSERT INTO surgery_request_activities (surgery_request_id, user_id, type, content) VALUES ($1, $2, 'status_change', 'Status alterado de Em Agendamento para Agendada')`,
    [srIds1[0], adminMedicoId],
  );

  // SR C1-4 (finalizada com contestação)
  await dataSource.query(
    `INSERT INTO surgery_request_activities (surgery_request_id, user_id, type, content) VALUES ($1, $2, 'pdf_generated', 'PDF da solicitação cirúrgica gerado automaticamente.')`,
    [srIds1[3], adminMedicoId],
  );
  await dataSource.query(
    `INSERT INTO surgery_request_activities (surgery_request_id, user_id, type, content) VALUES ($1, $2, 'comment', 'Convênio glosou R$ 4.600,00 referente ao implante. Contestação protocolada.')`,
    [srIds1[3], adminMedicoId],
  );

  logger.log('  ✅ Atividades criadas nas solicitações\n');

  // ========================================
  // 16. DOCUMENTOS nas solicitações
  // ========================================
  // Inserção de documentos em solicitações é omitida (depende de upload real
  // para o storage). A tabela `default_document_clinics` foi removida do
  // schema — não há mais documentos padrão da clínica.
  logger.log('⏭️ Documentos em solicitações são criados via upload real.\n');

  // ========================================
  // 17. CABEÇALHO DOS MÉDICOS (doctor_headers)
  // ========================================
  logger.log('🧩 Criando cabeçalhos dos médicos...');

  const doctorProfileRows = await dataSource.query(
    `SELECT id, user_id FROM doctor_profiles WHERE user_id = ANY($1::uuid[])`,
    [[adminMedicoId]],
  );
  for (const dp of doctorProfileRows) {
    await dataSource.query(
      `INSERT INTO doctor_headers (doctor_profile_id, logo_url, logo_position, content_html)
       VALUES ($1, NULL, 'left', $2)
       ON CONFLICT (doctor_profile_id) DO NOTHING`,
      [
        dp.id,
        '<p><strong>Clínica</strong> — Cabeçalho padrão para laudos (texto apenas, sem logo).</p>',
      ],
    );
  }

  logger.log(
    `  ✅ ${doctorProfileRows.length} cabeçalhos de médicos criados\n`,
  );

  // ========================================
  // RESUMO
  // ========================================
  logger.log('═══════════════════════════════════════════════════════════');
  logger.log('🎉 Seed concluído com sucesso!');
  logger.log('═══════════════════════════════════════════════════════════');
  logger.log('');
  logger.log('📊 Dados criados:');
  logger.log(
    '  • 9 planos de assinatura (starter/anual, essencial/anual, profissional/anual, avancado/anual, enterprise)',
  );
  logger.log('  • 20 procedimentos cirúrgicos');
  logger.log('  • CID/TUSS não são carregados automaticamente (carga manual)');
  logger.log('  • 1 conta (tenant isolation via owner_id)');
  logger.log('  • 1 usuário (admin + médico)');
  logger.log('  • 1 subscription ativa (plano Profissional)');
  logger.log('  • 2 hospitais (SP) com endereços reais');
  logger.log('  • 3 convênios com contatos de autorização');
  logger.log('  • 2 fornecedores de OPME');
  logger.log('  • 3 fabricantes de OPME (Zimmer Biomet, DePuy Synthes, Alcon)');
  logger.log(
    '  • 5 pacientes com dados completos (endereço, convênio, histórico)',
  );
  logger.log('  • 9 solicitações cirúrgicas (todos os 9 status cobertos)');
  logger.log(
    '  • OPME (com vínculo a fornecedores e fabricantes), cotações, análises, faturamentos, contestações, laudos',
  );
  logger.log('  • 2 templates de solicitação');
  logger.log('  • Atividades (comentários, mudanças de status, sistema)');
  logger.log(
    '  • 1 cabeçalho de médico (doctor_headers — texto apenas, sem logo)',
  );
  logger.log('');
  logger.log('🔐 Credenciais (senha: Teste123@):');
  logger.log('  ┌─────────────────────────────────────────────────────────┐');
  logger.log('  │ CONTA 1 (Ortopedia — São Paulo)                         │');
  logger.log('  │  medico@inexci.com        Admin + Médico (Ortopedia)    │');
  logger.log('  └─────────────────────────────────────────────────────────┘');

  await dataSource.destroy();
  process.exit(0);
}

main().catch((error) => {
  logger.error('❌ Erro durante o seed:', error);
  process.exit(1);
});
