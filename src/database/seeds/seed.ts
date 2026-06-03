import * as bcrypt from 'bcryptjs';
import { faker } from '@faker-js/faker';
import { Logger } from '@nestjs/common';
import { SeedDataSource } from '../typeorm/seed-data-source';
import { DEFAULT_PROCEDURE_NAMES } from '../../modules/procedures/default-procedures.constants';

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

  const hashedPassword = await bcrypt.hash('123456', 10);

  // ========================================
  // 1. PLANOS DE ASSINATURA
  // ========================================
  // Cria os planos default (idempotente via ON CONFLICT em slug).
  // Quota é por solicitações cirúrgicas enviadas/mês (-1 = ilimitado).
  logger.log('📋 Criando planos de assinatura...');

  await dataSource.query(`
    INSERT INTO subscription_plans
      (slug, name, description, price_cents, currency, billing_period, surgery_request_quota, is_active, is_trial_default, sort_order)
    VALUES
      ('starter',             'Starter',             'Ideal para médicos individuais começando agora',             45800,   'BRL', 'MONTHLY',  10, true,  true,  1),
      ('starter-anual',       'Starter Anual',       'Ideal para médicos individuais começando agora',             444000,  'BRL', 'YEARLY',   10, true,  false, 2),
      ('essencial',           'Essencial',           'Para clínicas pequenas e equipes em crescimento',            63400,   'BRL', 'MONTHLY',  20, true,  false, 3),
      ('essencial-anual',     'Essencial Anual',     'Para clínicas pequenas e equipes em crescimento',            655200,  'BRL', 'YEARLY',   20, true,  false, 4),
      ('profissional',        'Profissional',        'Para clínicas estabelecidas com alto volume cirúrgico',      81000,   'BRL', 'MONTHLY',  40, true,  false, 5),
      ('profissional-anual',  'Profissional Anual',  'Para clínicas estabelecidas com alto volume cirúrgico',      866400,  'BRL', 'YEARLY',   40, true,  false, 6),
      ('avancado',            'Avançado',            'Para grandes equipes com volume intenso de procedimentos',   98600,   'BRL', 'MONTHLY',  50, true,  false, 7),
      ('avancado-anual',      'Avançado Anual',      'Para grandes equipes com volume intenso de procedimentos',   1077600, 'BRL', 'YEARLY',   50, true,  false, 8),
      ('enterprise',          'Enterprise',          'Acima de 50 solicitações por mês — vamos conversar',        0,       'BRL', 'MONTHLY',  -1, true,  false, 9)
    ON CONFLICT (slug) DO NOTHING;
  `);

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
  let procedureIds: string[] = [];

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
  logger.log('  ✅ medico@inexci.com criado (admin + médico, Ortopedia)\n');

  // ========================================
  // 4. CONTA 2 — Dr. Rafael Andrade (Admin + Médico)
  //    admin@inexci.com — cardiologista, admin
  // ========================================
  logger.log('👤 Criando conta 2: admin@inexci.com (admin + médico)...');

  const preGen2 = await dataSource.query(`SELECT uuid_generate_v4() AS id`);
  const adminId = preGen2[0].id;

  await dataSource.query(
    `INSERT INTO "users" (id, name, email, password, phone, cpf, gender, birth_date, role, status, owner_id, admin_id, email_verified, email_verified_at, privacy_policy_accepted_at, terms_of_use_accepted_at, ai_consent_accepted_at)
     VALUES ($1,'Dr. Rafael Andrade','admin@inexci.com',$2,'21998765432','${generateCPF()}','M','1968-09-22','admin','active',$1,NULL,true,NOW(),NOW(),NOW(),NOW())`,
    [adminId, hashedPassword],
  );
  await dataSource.query(
    `INSERT INTO doctor_profiles (user_id, crm, crm_state, specialty, clinic_name, clinic_cnpj, clinic_address)
     VALUES ($1,'98765','RJ','Cardiologia Intervencionista','Instituto Cardíaco Andrade','${generateCNPJ()}','Rua das Laranjeiras, 300 - Laranjeiras - Rio de Janeiro, RJ - CEP 22240-003')`,
    [adminId],
  );
  await createActiveSubscription(dataSource, adminId, professionalPlanId);
  logger.log('  ✅ admin@inexci.com criado (admin + médico, Cardiologia)\n');

  const procedureIdsConta1 = await createDefaultProceduresForOwner(
    dataSource,
    adminMedicoId,
  );
  const procedureIdsConta2 = await createDefaultProceduresForOwner(
    dataSource,
    adminId,
  );
  // Mantém compatibilidade do restante do seed (majoritariamente conta 2)
  procedureIds = procedureIdsConta2;
  logger.log(
    `✅ Procedimentos criados por conta: conta1=${procedureIdsConta1.length}, conta2=${procedureIdsConta2.length}\n`,
  );

  // ========================================
  // 5. COLABORADORES DA CONTA 2 (admin@inexci.com)
  // ========================================
  logger.log('👩‍💼 Criando colaboradores da conta 2...');

  // Médica colaboradora — Dra. Fernanda Rocha (neurocirurgiã)
  const collabMedicaResult = await dataSource.query(
    `INSERT INTO "users" (name, email, password, phone, cpf, gender, birth_date, role, status, owner_id, admin_id, email_verified, email_verified_at, privacy_policy_accepted_at, terms_of_use_accepted_at, ai_consent_accepted_at)
     VALUES ('Dra. Fernanda Rocha','medica@inexci.com',$1,'21976543210','${generateCPF()}','F','1980-03-15','collaborator','active',$2,$2,true,NOW(),NOW(),NOW(),NOW())
     RETURNING id`,
    [hashedPassword, adminId],
  );
  const collabMedicaId = collabMedicaResult[0].id;
  await dataSource.query(
    `INSERT INTO doctor_profiles (user_id, crm, crm_state, specialty, clinic_name, clinic_cnpj, clinic_address)
     VALUES ($1,'55443','RJ','Neurocirurgia','Clínica Neuro Rocha','${generateCNPJ()}','Av. Nossa Senhora de Copacabana, 680 - Copacabana - Rio de Janeiro, RJ')`,
    [collabMedicaId],
  );
  logger.log('  ➕ medica@inexci.com — Dra. Fernanda Rocha (neurocirurgiã)');

  // Assistente 1 — Camila Borges
  const assistente1Result = await dataSource.query(
    `INSERT INTO "users" (name, email, password, phone, cpf, gender, birth_date, role, status, owner_id, admin_id, email_verified, email_verified_at, privacy_policy_accepted_at, terms_of_use_accepted_at, ai_consent_accepted_at)
     VALUES ('Camila Borges','assistente1@inexci.com',$1,'21965432109','${generateCPF()}','F','1993-07-28','collaborator','active',$2,$2,true,NOW(),NOW(),NOW(),NOW())
     RETURNING id`,
    [hashedPassword, adminId],
  );
  const assistente1Id = assistente1Result[0].id;
  logger.log('  ➕ assistente1@inexci.com — Camila Borges (assistente)');

  // Assistente 2 — Lucas Teixeira
  const assistente2Result = await dataSource.query(
    `INSERT INTO "users" (name, email, password, phone, cpf, gender, birth_date, role, status, owner_id, admin_id, email_verified, email_verified_at, privacy_policy_accepted_at, terms_of_use_accepted_at, ai_consent_accepted_at)
     VALUES ('Lucas Teixeira','assistente2@inexci.com',$1,'21954321098','${generateCPF()}','M','1997-11-05','collaborator','active',$2,$2,true,NOW(),NOW(),NOW(),NOW())
     RETURNING id`,
    [hashedPassword, adminId],
  );
  const assistente2Id = assistente2Result[0].id;
  logger.log('  ➕ assistente2@inexci.com — Lucas Teixeira (assistente)');

  // Secretária — Juliana Matos (pendente de ativação)
  const secretariaResult = await dataSource.query(
    `INSERT INTO "users" (name, email, password, phone, cpf, gender, birth_date, role, status, owner_id, admin_id, email_verified, email_verified_at, privacy_policy_accepted_at, terms_of_use_accepted_at, ai_consent_accepted_at)
     VALUES ('Juliana Matos','secretaria@inexci.com',$1,'21943210987','${generateCPF()}','F','1991-02-14','collaborator','pending',$2,$2,true,NOW(),NOW(),NOW(),NOW())
     RETURNING id`,
    [hashedPassword, adminId],
  );
  const secretariaId = secretariaResult[0].id;
  logger.log(
    '  ➕ secretaria@inexci.com — Juliana Matos (secretária, pendente)',
  );
  logger.log('  ✅ 4 colaboradores criados\n');

  // ========================================
  // 6. COLABORADORES DA CONTA 1 (medico@inexci.com)
  // ========================================
  logger.log('👩‍💼 Criando colaboradores da conta 1...');

  const assistenteOrtResult = await dataSource.query(
    `INSERT INTO "users" (name, email, password, phone, cpf, gender, birth_date, role, status, owner_id, admin_id, email_verified, email_verified_at, privacy_policy_accepted_at, terms_of_use_accepted_at, ai_consent_accepted_at)
     VALUES ('Patricia Souza','assistente.ort@inexci.com',$1,'11976543210','${generateCPF()}','F','1995-06-18','collaborator','active',$2,$2,true,NOW(),NOW(),NOW(),NOW())
     RETURNING id`,
    [hashedPassword, adminMedicoId],
  );
  const assistenteOrtId = assistenteOrtResult[0].id;
  logger.log('  ➕ assistente.ort@inexci.com — Patricia Souza (assistente)');
  logger.log('  ✅ 1 colaborador criado\n');

  // ========================================
  // 7. VÍNCULOS user_doctor_access
  // ========================================
  logger.log('🔗 Criando vínculos de acesso...');

  // Conta 2: assistente1 → admin + medica
  await dataSource.query(
    `INSERT INTO user_doctor_accesses (user_id, doctor_user_id, status, created_by_id) VALUES ($1,$2,'active',$3)`,
    [assistente1Id, adminId, adminId],
  );
  await dataSource.query(
    `INSERT INTO user_doctor_accesses (user_id, doctor_user_id, status, created_by_id) VALUES ($1,$2,'active',$3)`,
    [assistente1Id, collabMedicaId, adminId],
  );
  // Conta 2: assistente2 → apenas medica
  await dataSource.query(
    `INSERT INTO user_doctor_accesses (user_id, doctor_user_id, status, created_by_id) VALUES ($1,$2,'active',$3)`,
    [assistente2Id, collabMedicaId, adminId],
  );
  // Conta 2: secretaria → admin
  await dataSource.query(
    `INSERT INTO user_doctor_accesses (user_id, doctor_user_id, status, created_by_id) VALUES ($1,$2,'active',$3)`,
    [secretariaId, adminId, adminId],
  );
  // Conta 1: assistenteOrt → adminMedico
  await dataSource.query(
    `INSERT INTO user_doctor_accesses (user_id, doctor_user_id, status, created_by_id) VALUES ($1,$2,'active',$3)`,
    [assistenteOrtId, adminMedicoId, adminMedicoId],
  );
  logger.log('  ✅ 5 vínculos de acesso criados\n');

  // ========================================
  // 8. HOSPITAIS
  // ========================================
  logger.log('🏥 Criando hospitais...');

  // Hospitais pertencem à clínica (tenant), via owner_id. Os hospitais 0..2
  // são da conta 2 (owner = adminId) e os hospitais 3..4 são da conta 1
  // (owner = adminMedicoId). Qualquer médico/colaborador da mesma conta
  // pode usá-los nas solicitações cirúrgicas.
  const hospitalsData = [
    // Conta 2 (admin@inexci.com)
    {
      name: "Hospital Copa D'Or",
      cnpj: generateCNPJ(),
      city: 'Rio de Janeiro',
      state: 'RJ',
      zip_code: '22031-011',
      address: 'Rua Figueiredo Magalhães',
      address_number: '875',
      neighborhood: 'Copacabana',
      phone: '2125451212',
      contact_name: 'Roberto Alves',
      contact_phone: '21998001234',
      contact_email: 'autorizacoes@copador.com.br',
      owner_id: adminId,
    },
    {
      name: "Hospital Barra D'Or",
      cnpj: generateCNPJ(),
      city: 'Rio de Janeiro',
      state: 'RJ',
      zip_code: '22793-080',
      address: 'Av. Ayrton Senna',
      address_number: '2541',
      neighborhood: 'Barra da Tijuca',
      phone: '2135550000',
      contact_name: 'Sônia Lima',
      contact_phone: '21997654321',
      contact_email: 'autorizacoes@barrador.com.br',
      owner_id: adminId,
    },
    {
      name: 'Casa de Saúde São José',
      cnpj: generateCNPJ(),
      city: 'Rio de Janeiro',
      state: 'RJ',
      zip_code: '22241-001',
      address: 'Rua Mário Pederneiras',
      address_number: '10',
      neighborhood: 'Humaitá',
      phone: '2125271300',
      contact_name: 'Ana Cristina',
      contact_phone: '21996543210',
      contact_email: 'cirurgia@saosejorj.com.br',
      owner_id: adminId,
    },
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
  // hospitalIds[0..2] = conta 2, hospitalIds[3..4] = conta 1

  // ========================================
  // 9. CONVÊNIOS
  // ========================================
  logger.log('💳 Criando convênios...');

  // Convênios pertencem à clínica (tenant), via owner_id. Os 4 primeiros
  // são da conta 2 (owner = adminId) e os 3 últimos da conta 1
  // (owner = adminMedicoId).
  const healthPlansData = [
    // Conta 2
    {
      name: 'Unimed-Rio',
      ans_code: '301337',
      phone: '2130030300',
      auth_phone: '2130030301',
      auth_email: 'autorizacoes@unimedrio.com.br',
      website: 'https://www.unimedrio.com.br',
      default_payment_days: 30,
      owner_id: adminId,
    },
    {
      name: 'Amil',
      ans_code: '326305',
      phone: '2140042424',
      auth_phone: '2140042425',
      auth_email: 'autorizacoes@amil.com.br',
      website: 'https://www.amil.com.br',
      default_payment_days: 28,
      owner_id: adminId,
    },
    {
      name: 'SulAmérica Saúde',
      ans_code: '006246',
      phone: '2140031212',
      auth_phone: '2140031213',
      auth_email: 'autorizacoes@sulamerica.com.br',
      website: 'https://portal.sulamerica.com.br',
      default_payment_days: 30,
      owner_id: adminId,
    },
    {
      name: 'Bradesco Saúde',
      ans_code: '005711',
      phone: '1140041111',
      auth_phone: '1140041112',
      auth_email: 'autorizacoes@bradesaude.com.br',
      website: 'https://www.bradescosaude.com.br',
      default_payment_days: 35,
      owner_id: adminId,
    },
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
  // healthPlanIds[0..3] = conta 2, healthPlanIds[4..6] = conta 1

  // ========================================
  // 10. FORNECEDORES DE OPME
  // ========================================
  logger.log('📦 Criando fornecedores...');

  // Fornecedores pertencem à clínica (tenant), via owner_id. Índices 0..2
  // são da conta 2 (owner = adminId) e índices 3..4 da conta 1
  // (owner = adminMedicoId).
  const suppliersData = [
    // Conta 2
    {
      name: 'BioMed Implantes Ltda',
      contact_name: 'Rodrigo Faria',
      contact_phone: '21997001234',
      contact_email: 'rodrigo@biomed.com.br',
      city: 'Rio de Janeiro',
      state: 'RJ',
      owner_id: adminId,
    },
    {
      name: 'Stryker do Brasil',
      contact_name: 'Tatiana Melo',
      contact_phone: '21996005678',
      contact_email: 'tatiana@stryker.com.br',
      city: 'Rio de Janeiro',
      state: 'RJ',
      owner_id: adminId,
    },
    {
      name: 'Synthes Johnson & Johnson',
      contact_name: 'Marcelo Gomes',
      contact_phone: '21995009012',
      contact_email: 'marcelo@synthes.com.br',
      city: 'Rio de Janeiro',
      state: 'RJ',
      owner_id: adminId,
    },
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
  // 11. PACIENTES — Conta 2 (admin@inexci.com)
  // ========================================
  logger.log('🧑‍🤝‍🧑 Criando pacientes da conta 2...');

  const patientsData2 = [
    {
      doctor_id: adminId,
      name: 'Roberto Carlos Ferreira',
      email: 'roberto.ferreira@gmail.com',
      gender: 'M',
      birth: '1958-11-14',
      cpf: generateCPF(),
      phone: '21998001111',
      zip_code: '22041-001',
      address: 'Rua Barata Ribeiro',
      address_number: '500',
      neighborhood: 'Copacabana',
      city: 'Rio de Janeiro',
      state: 'RJ',
      hp_idx: 0,
      hp_number: '0012345678',
      hp_type: 'Apartamento',
      notes: 'Hipertensão arterial controlada. Alergia a penicilina.',
    },
    {
      doctor_id: adminId,
      name: 'Sandra Aparecida Lima',
      email: 'sandra.lima@hotmail.com',
      gender: 'F',
      birth: '1965-06-03',
      cpf: generateCPF(),
      phone: '21987002222',
      zip_code: '22441-110',
      address: 'Rua Voluntários da Pátria',
      address_number: '220',
      neighborhood: 'Botafogo',
      city: 'Rio de Janeiro',
      state: 'RJ',
      hp_idx: 1,
      hp_number: '9876543210',
      hp_type: 'Apartamento',
      notes: 'Diabética tipo 2. Uso contínuo de metformina.',
    },
    {
      doctor_id: adminId,
      name: 'Antônio José Nascimento',
      email: 'antonio.nascimento@yahoo.com.br',
      gender: 'M',
      birth: '1972-02-28',
      cpf: generateCPF(),
      phone: '21976003333',
      zip_code: '22793-080',
      address: 'Av. das Américas',
      address_number: '3434',
      neighborhood: 'Barra da Tijuca',
      city: 'Rio de Janeiro',
      state: 'RJ',
      hp_idx: 2,
      hp_number: '1122334455',
      hp_type: 'Enfermaria',
      notes: null,
    },
    {
      doctor_id: adminId,
      name: 'Maria Eduarda Silveira',
      email: 'mariaedu.silveira@gmail.com',
      gender: 'F',
      birth: '1989-09-17',
      cpf: generateCPF(),
      phone: '21965004444',
      zip_code: '20040-020',
      address: 'Av. Rio Branco',
      address_number: '1500',
      neighborhood: 'Centro',
      city: 'Rio de Janeiro',
      state: 'RJ',
      hp_idx: 0,
      hp_number: '5544332211',
      hp_type: 'Apartamento',
      notes: 'Gestante com 10 semanas. Cirurgia eletiva aguardando puerpério.',
    },
    {
      doctor_id: adminId,
      name: 'Carlos Eduardo Pinto',
      email: 'carlos.pinto@terra.com.br',
      gender: 'M',
      birth: '1951-04-22',
      cpf: generateCPF(),
      phone: '21954005555',
      zip_code: '22230-010',
      address: 'Rua Praia do Flamengo',
      address_number: '100',
      neighborhood: 'Flamengo',
      city: 'Rio de Janeiro',
      state: 'RJ',
      hp_idx: 1,
      hp_number: '6677889900',
      hp_type: 'Apartamento Superior',
      notes: 'Histórico de fibrilação atrial. Anticoagulado com warfarina.',
    },
    {
      doctor_id: collabMedicaId,
      name: 'Luciana Mendes Barbosa',
      email: 'luciana.barbosa@gmail.com',
      gender: 'F',
      birth: '1976-12-01',
      cpf: generateCPF(),
      phone: '21943006666',
      zip_code: '22250-040',
      address: 'Rua das Laranjeiras',
      address_number: '400',
      neighborhood: 'Laranjeiras',
      city: 'Rio de Janeiro',
      state: 'RJ',
      hp_idx: 3,
      hp_number: '1029384756',
      hp_type: 'Apartamento',
      notes:
        'Cefaleia crônica refratária. Indicação de descompressão de nervo occipital.',
    },
    {
      doctor_id: collabMedicaId,
      name: 'Paulo Henrique Oliveira',
      email: 'paulo.oliveira@outlook.com',
      gender: 'M',
      birth: '1983-07-09',
      cpf: generateCPF(),
      phone: '21932007777',
      zip_code: '22050-001',
      address: 'Av. Nossa Senhora de Copacabana',
      address_number: '1200',
      neighborhood: 'Copacabana',
      city: 'Rio de Janeiro',
      state: 'RJ',
      hp_idx: 3,
      hp_number: '0918273645',
      hp_type: 'Enfermaria',
      notes:
        'Hérnia de disco L4-L5 com radiculopatia. Tratamento conservador sem resposta.',
    },
    {
      doctor_id: collabMedicaId,
      name: 'Renata Cristina Alves',
      email: 'renata.alves@gmail.com',
      gender: 'F',
      birth: '1995-03-25',
      cpf: generateCPF(),
      phone: '21921008888',
      zip_code: '22610-210',
      address: 'Estrada dos Bandeirantes',
      address_number: '2000',
      neighborhood: 'Jacarepaguá',
      city: 'Rio de Janeiro',
      state: 'RJ',
      hp_idx: 3,
      hp_number: '5647382910',
      hp_type: 'Apartamento',
      notes: null,
    },
  ];

  const patientIds2: string[] = [];
  for (const p of patientsData2) {
    const hpId = healthPlanIds[p.hp_idx];
    const r = await dataSource.query(
      `INSERT INTO patients (doctor_id, owner_id, name, email, phone, cpf, gender, birth_date, health_plan_id, health_plan_number, health_plan_type, zip_code, address, address_number, neighborhood, city, state, medical_notes, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,true) RETURNING id`,
      [
        p.doctor_id,
        adminId,
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
    patientIds2.push(r[0].id);
  }
  logger.log(`  ✅ ${patientIds2.length} pacientes criados para conta 2\n`);

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
      hp_idx: 4,
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
      hp_idx: 5,
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
      hp_idx: 4,
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
      hp_idx: 6,
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
      hp_idx: 4,
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
  // 13. SOLICITAÇÕES CIRÚRGICAS — todos os status
  //     Conta 2 (admin@inexci.com)
  // ========================================
  logger.log('📋 Criando solicitações cirúrgicas (conta 2)...');

  const srIds2: string[] = [];

  // SR 1 — Status PENDING (Pendente) — paciente 0
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, diagnosis, medical_report, patient_history, surgery_description, health_plan_registration, health_plan_type)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,1,2,NULL,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        adminId,
        adminId,
        patientIds2[0],
        hospitalIds[0],
        healthPlanIds[0],
        procedureIds[0],
        'Colelitíase sintomática com episódios repetidos de colecistite aguda. USG revelou cálculos múltiplos com espessamento de parede.',
        'Paciente apresenta quadro de dor em hipocôndrio direito há 8 meses com irradiação para escápula direita. Diagnóstico confirmado por ultrassonografia.',
        'Hipertensão arterial sistêmica controlada. Alergia a penicilina documentada. ASA II.',
        'Colecistectomia videolaparoscópica com clipagem do ducto e artéria cística. Acesso de 4 portais.',
        '0012345678',
        'Apartamento',
      ],
    );
    srIds2.push(r[0].id);
  }

  // SR 2 — Status SENT (Enviada) — paciente 1
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, diagnosis, medical_report, patient_history, surgery_description, health_plan_registration, health_plan_type, sent_at, send_method)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,2,3,false,$7,$8,$9,$10,$11,$12,NOW() - INTERVAL '3 days','email') RETURNING id`,
      [
        adminId,
        assistente1Id,
        patientIds2[1],
        hospitalIds[0],
        healthPlanIds[1],
        procedureIds[2],
        'Hérnia umbilical de 3 cm com conteúdo epiplóico. Assintomática mas com aumento progressivo.',
        'Paciente relata abaulamento umbilical há 2 anos com progressão nos últimos 6 meses. Exame físico confirma hérnia redutível.',
        'Diabetes mellitus tipo 2 em controle. Hemoglobina glicada 6,8%. HAS compensada.',
        'Herniorrafia umbilical com tela de polipropileno. Acesso por incisão periumbilical.',
        '9876543210',
        'Apartamento',
      ],
    );
    srIds2.push(r[0].id);
    await recordStatusChange(dataSource, r[0].id, 1, 2);
  }

  // SR 3 — Status IN_ANALYSIS (Em Análise) com analysis record — paciente 2
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, diagnosis, medical_report, patient_history, surgery_description, health_plan_registration, health_plan_type, sent_at, send_method, analysis_started_at)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,3,2,true,$7,$8,$9,$10,$11,$12,NOW() - INTERVAL '10 days','email',NOW() - INTERVAL '8 days') RETURNING id`,
      [
        adminId,
        adminId,
        patientIds2[2],
        hospitalIds[1],
        healthPlanIds[2],
        procedureIds[4],
        'Gonartrose severa bilateral (KL grau IV). Dor intratável em ambos os joelhos limitando deambulação.',
        'Paciente com histórico de 5 anos de dor progressiva nos joelhos. RX demonstra pinçamento articular bilateral e osteofitose proeminente. Sem resposta a tratamento conservador.',
        'Hipertensão arterial. Tabagismo cessante há 2 anos. ASA II. Risco cirúrgico cardiovascular baixo conforme avaliação cardiológica.',
        'Artroplastia total do joelho direito com implante cimentado. Uso de torniquete pneumático. Tempo cirúrgico estimado 2h.',
        '1122334455',
        'Enfermaria',
      ],
    );
    srIds2.push(r[0].id);
    await recordStatusChange(dataSource, r[0].id, 1, 2);
    await recordStatusChange(dataSource, r[0].id, 2, 3);
    await dataSource.query(
      `INSERT INTO surgery_request_analyses (surgery_request_id, request_number, received_at, quotation_1_number, quotation_1_received_at, notes)
       VALUES ($1,'SUL-2024-00847',NOW() - INTERVAL '8 days','COT-SUL-001',NOW() - INTERVAL '5 days','Cotação de OPME pendente de 2ª e 3ª via.')`,
      [r[0].id],
    );
    // OPME items
    const opme3a = await dataSource.query(
      `INSERT INTO opme_items (surgery_request_id, name, brand, quantity) VALUES ($1,'Prótese total de joelho cimentada - tamanho 4','Stryker Triathlon',1) RETURNING id`,
      [r[0].id],
    );
    await dataSource.query(
      `INSERT INTO opme_item_suppliers (opme_item_id, supplier_id) VALUES ($1,$2)`,
      [opme3a[0].id, supplierIds[1]],
    );
    const opme3b = await dataSource.query(
      `INSERT INTO opme_items (surgery_request_id, name, brand, quantity) VALUES ($1,'Dreno de Hemovac 10mm','Portex',2) RETURNING id`,
      [r[0].id],
    );
    await dataSource.query(
      `INSERT INTO opme_item_suppliers (opme_item_id, supplier_id) VALUES ($1,$2)`,
      [opme3b[0].id, supplierIds[0]],
    );
    // Cotação
    await dataSource.query(
      `INSERT INTO surgery_request_quotations (surgery_request_id, supplier_id, proposal_number, total_value, submission_date, valid_until, notes, selected)
       VALUES ($1,$2,'COT-BIO-2024-112',18500.00,NOW() - INTERVAL '5 days',NOW() + INTERVAL '25 days','Inclui set de instrumentais sem custo adicional.',false)`,
      [r[0].id, supplierIds[1]],
    );
  }

  // SR 4 — Status IN_SCHEDULING (Em Agendamento) — paciente 3
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, diagnosis, medical_report, patient_history, surgery_description, health_plan_registration, health_plan_type, sent_at, analysis_started_at, health_plan_protocol, date_options)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,4,2,false,$7,$8,$9,$10,$11,$12,NOW() - INTERVAL '20 days',NOW() - INTERVAL '17 days','AMIL-20240358',$13) RETURNING id`,
      [
        adminId,
        assistente1Id,
        patientIds2[3],
        hospitalIds[0],
        healthPlanIds[1],
        procedureIds[0],
        'Colelitíase com episódio recente de pancreatite biliar. Indicação de colecistectomia após resolução do quadro agudo.',
        'Paciente encaminhada da UTI após pancreatite aguda biliar. Amilase normalizada. Alta hospitalar há 3 semanas.',
        'Gestante com 10 semanas. Pancreatite biliar resolvida. Aguardando avaliação obstétrica para autorização cirúrgica.',
        'Colecistectomia videolaparoscópica eletiva. Decúbito lateral esquerdo. Insuflação com CO2 a 12mmHg.',
        '5544332211',
        'Apartamento',
        JSON.stringify(
          (() => {
            const buildSlot = (daysAhead: number, hour: number, minute = 0) => {
              const d = new Date();
              d.setDate(d.getDate() + daysAhead);
              d.setHours(hour, minute, 0, 0);
              return d.toISOString();
            };
            return [
              buildSlot(7, 7, 30),
              buildSlot(14, 13, 0),
              buildSlot(21, 8, 0),
            ];
          })(),
        ),
      ],
    );
    srIds2.push(r[0].id);
    await recordStatusChange(dataSource, r[0].id, 1, 2);
    await recordStatusChange(dataSource, r[0].id, 2, 3);
    await recordStatusChange(dataSource, r[0].id, 3, 4);
  }

  // SR 5 — Status SCHEDULED (Agendada) — paciente 4
  {
    const surgeryDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, diagnosis, medical_report, patient_history, surgery_description, health_plan_registration, health_plan_type, sent_at, analysis_started_at, health_plan_protocol, surgery_date, selected_date_index, hospital_protocol)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,5,3,true,$7,$8,$9,$10,$11,$12,NOW() - INTERVAL '25 days',NOW() - INTERVAL '22 days','UNIMED-20240612',$13,0,'HCD-2024-8834') RETURNING id`,
      [
        adminId,
        adminId,
        patientIds2[4],
        hospitalIds[0],
        healthPlanIds[0],
        procedureIds[12],
        'Doença arterial coronariana trisvasal com fração de ejeção preservada (FE 65%). Coronariografia demonstra lesões críticas em DA, CX e CD.',
        'Paciente de 72 anos com angina estável refratária ao tratamento clínico. Cintilografia miocárdica com isquemia extensa. Indicado tratamento cirúrgico pelo Heart Team.',
        'FA paroxística anticoagulada. HAS. DM2. Tabagismo cessante há 10 anos. Score de EuroSCORE II: 2,4%.',
        'Revascularização do miocárdio com circulação extracorpórea. Enxertos: AMIE para DA, VSM para CX e CD.',
        '6677889900',
        'Apartamento Superior',
        surgeryDate,
      ],
    );
    srIds2.push(r[0].id);
    await recordStatusChange(dataSource, r[0].id, 1, 2);
    await recordStatusChange(dataSource, r[0].id, 2, 3);
    await recordStatusChange(dataSource, r[0].id, 3, 4);
    await recordStatusChange(dataSource, r[0].id, 4, 5);
    const opme5a = await dataSource.query(
      `INSERT INTO opme_items (surgery_request_id, name, brand, quantity, authorized_quantity) VALUES ($1,'Enxerto de veia safena (set)','Biomet',1,1) RETURNING id`,
      [r[0].id],
    );
    await dataSource.query(
      `INSERT INTO opme_item_suppliers (opme_item_id, supplier_id) VALUES ($1,$2)`,
      [opme5a[0].id, supplierIds[1]],
    );
    const opme5b = await dataSource.query(
      `INSERT INTO opme_items (surgery_request_id, name, brand, quantity, authorized_quantity) VALUES ($1,'Oxigenador de membrana','Sorin Group',1,1) RETURNING id`,
      [r[0].id],
    );
    await dataSource.query(
      `INSERT INTO opme_item_suppliers (opme_item_id, supplier_id) VALUES ($1,$2)`,
      [opme5b[0].id, supplierIds[0]],
    );
    await dataSource.query(
      `INSERT INTO surgery_request_quotations (surgery_request_id, supplier_id, proposal_number, total_value, submission_date, valid_until, selected)
       VALUES ($1,$2,'COT-STR-2024-330',32000.00,NOW() - INTERVAL '18 days',NOW() + INTERVAL '12 days',true)`,
      [r[0].id, supplierIds[1]],
    );
  }

  // SR 6 — Status PERFORMED (Realizada) — paciente 0 (segunda cirurgia)
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, diagnosis, medical_report, patient_history, surgery_description, health_plan_registration, health_plan_type, sent_at, analysis_started_at, health_plan_protocol, surgery_date, surgery_performed_at)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,6,2,false,$7,$8,$9,$10,$11,$12,NOW() - INTERVAL '45 days',NOW() - INTERVAL '42 days','UNIMED-20240288',NOW() - INTERVAL '15 days',NOW() - INTERVAL '15 days') RETURNING id`,
      [
        adminId,
        assistente1Id,
        patientIds2[0],
        hospitalIds[1],
        healthPlanIds[0],
        procedureIds[8],
        'Urolitíase com cálculo ureteral obstrutivo de 12mm no ureter proximal esquerdo. Hidronefrose leve.',
        'Paciente com episódio de cólica renal intensa. TC demonstra cálculo ureteral obstrutivo. Sem sinais de infecção.',
        'HAS compensada. Alergia a penicilina. Função renal preservada (creatinina 0,9).',
        'Nefrolitotripsia percutânea com litotripsora ultrassônica. Acesso percutâneo posterolateral.',
        '0012345678',
        'Apartamento',
      ],
    );
    srIds2.push(r[0].id);
    for (const [prev, next] of [
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
    ]) {
      await recordStatusChange(dataSource, r[0].id, prev, next);
    }
    await dataSource.query(
      `INSERT INTO report_sections (surgery_request_id, title, description, "order") VALUES ($1,'Histórico e Diagnóstico','<p>Paciente com cólica renal de repetição. TC de abdome confirmou urolitíase com cálculo obstrutivo de 12mm. Sem resposta a tratamento conservador.</p>',1)`,
      [r[0].id],
    );
    await dataSource.query(
      `INSERT INTO report_sections (surgery_request_id, title, description, "order") VALUES ($1,'Conduta','<p>Indicada nefrolitotripsia percutânea. Paciente orientado sobre o procedimento, riscos e benefícios. Consentimento informado assinado.</p>',2)`,
      [r[0].id],
    );
  }

  // SR 7 — Status INVOICED (Faturada) — paciente 1
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, diagnosis, medical_report, patient_history, surgery_description, health_plan_registration, health_plan_type, sent_at, surgery_performed_at)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,7,1,false,$7,$8,$9,$10,$11,$12,NOW() - INTERVAL '60 days',NOW() - INTERVAL '30 days') RETURNING id`,
      [
        adminId,
        adminId,
        patientIds2[1],
        hospitalIds[1],
        healthPlanIds[2],
        procedureIds[13],
        'Dispepsia refratária com suspeita de H. pylori. Indicação de EDA diagnóstica e terapêutica.',
        'Paciente relata pirose e epigastralgia há 3 meses. Sem resposta a IBP em dose plena.',
        'DM2 controlada. Sem contraindicações ao procedimento endoscópico.',
        'Endoscopia digestiva alta com biópsia de antro e corpo gástrico para pesquisa de H. pylori.',
        '9876543210',
        'Apartamento',
      ],
    );
    srIds2.push(r[0].id);
    for (const [prev, next] of [
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
    ]) {
      await recordStatusChange(dataSource, r[0].id, prev, next);
    }
    await dataSource.query(
      `INSERT INTO surgery_request_billings (surgery_request_id, created_by_id, invoice_protocol, invoice_sent_at, invoice_value, payment_deadline)
       VALUES ($1,$2,'FAT-SUL-2024-00334',NOW() - INTERVAL '10 days',1850.00,NOW() + INTERVAL '20 days')`,
      [r[0].id, adminId],
    );
  }

  // SR 8 — Status FINALIZED (Finalizada) — paciente 2
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, diagnosis, medical_report, patient_history, surgery_description, health_plan_registration, health_plan_type, sent_at, surgery_performed_at)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,8,2,false,$7,$8,$9,$10,$11,$12,NOW() - INTERVAL '90 days',NOW() - INTERVAL '60 days') RETURNING id`,
      [
        adminId,
        assistente1Id,
        patientIds2[2],
        hospitalIds[1],
        healthPlanIds[2],
        procedureIds[9],
        'Desvio septal grau III com rinite obstrutiva crônica e roncopatia. Sem resposta ao tratamento clínico.',
        'Paciente relata obstrução nasal bilateral há 5 anos, rinorreia, ronco e apneia do sono leve.',
        'Alérgico a dipirona. Sem comorbidades relevantes. ASA I.',
        'Septoplastia com turbinectomia parcial inferior bilateral. Anestesia geral. Uso de tamponamento nasal por 24h.',
        '1122334455',
        'Enfermaria',
      ],
    );
    srIds2.push(r[0].id);
    for (const [prev, next] of [
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 8],
    ]) {
      await recordStatusChange(dataSource, r[0].id, prev, next);
    }
    await dataSource.query(
      `INSERT INTO surgery_request_billings (surgery_request_id, created_by_id, invoice_protocol, invoice_sent_at, invoice_value, payment_deadline, received_value, received_at, receipt_notes)
       VALUES ($1,$2,'FAT-SUL-2024-00089',NOW() - INTERVAL '50 days',2400.00,NOW() - INTERVAL '20 days',2400.00,NOW() - INTERVAL '22 days','Pagamento recebido integral sem glosa.')`,
      [r[0].id, adminId],
    );
  }

  // SR 9 — Status CLOSED (Encerrada / recusada) — paciente 3
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, diagnosis, medical_report, patient_history, surgery_description, health_plan_registration, health_plan_type, sent_at, cancel_reason, closed_at)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,9,2,false,$7,$8,$9,$10,$11,$12,NOW() - INTERVAL '40 days','Convênio negou autorização alegando documentação incompleta. Decisão contestada e aguardando reanálise em nova solicitação.',NOW() - INTERVAL '5 days') RETURNING id`,
      [
        adminId,
        adminId,
        patientIds2[3],
        hospitalIds[0],
        healthPlanIds[1],
        procedureIds[14],
        'Pólipo de cólon de 18mm no sigmóide. Colonoscopia prévia com biópsia: adenoma tubular sem displasia de alto grau.',
        'Colonoscopia de rotina identificou pólipo sessil de 18mm. Indicada polipectomia endoscópica.',
        'Sem comorbidades relevantes. Colonoscopia prévia sem intercorrências. ASA I.',
        'Colonoscopia com polipectomia por alça fria. Sedação com propofol. Preparo intestinal com manitol.',
        '5544332211',
        'Apartamento',
      ],
    );
    srIds2.push(r[0].id);
    await recordStatusChange(dataSource, r[0].id, 1, 2);
    await recordStatusChange(dataSource, r[0].id, 2, 9);
  }

  // SR 10 — Dra. Fernanda Rocha (neurocirurgia) — paciente 5
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, diagnosis, medical_report, patient_history, surgery_description, health_plan_registration, health_plan_type, sent_at, analysis_started_at, health_plan_protocol)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,3,3,true,$7,$8,$9,$10,$11,$12,NOW() - INTERVAL '12 days',NOW() - INTERVAL '9 days','BRAD-20241122') RETURNING id`,
      [
        collabMedicaId,
        collabMedicaId,
        patientIds2[5],
        hospitalIds[2],
        healthPlanIds[3],
        procedureIds[6],
        'Hérnia discal L4-L5 com radiculopatia L5 direita. RNM: extrusão foraminal com compressão radicular.',
        'Paciente com lombalgia irradiada para MID há 18 meses. Testes de provocação positivos. EMG: radiculopatia L5 direita.',
        'Sem comorbidades. Fisioterapia e bloqueio epidural sem melhora. IMC 24. ASA I.',
        'Discectomia lombar por via posterior (microdiscectomia). Acesso interlaminar L4-L5.',
        '1029384756',
        'Apartamento',
      ],
    );
    srIds2.push(r[0].id);
    await recordStatusChange(dataSource, r[0].id, 1, 2);
    await recordStatusChange(dataSource, r[0].id, 2, 3);
    const opme10a = await dataSource.query(
      `INSERT INTO opme_items (surgery_request_id, name, brand, quantity) VALUES ($1,'Cage intersomático TLIF PEEK','Medtronic',1) RETURNING id`,
      [r[0].id],
    );
    await dataSource.query(
      `INSERT INTO opme_item_suppliers (opme_item_id, supplier_id) VALUES ($1,$2)`,
      [opme10a[0].id, supplierIds[2]],
    );
    const opme10b = await dataSource.query(
      `INSERT INTO opme_items (surgery_request_id, name, brand, quantity) VALUES ($1,'Parafusos pediculares (kit 4)','Synthes',1) RETURNING id`,
      [r[0].id],
    );
    await dataSource.query(
      `INSERT INTO opme_item_suppliers (opme_item_id, supplier_id) VALUES ($1,$2)`,
      [opme10b[0].id, supplierIds[2]],
    );
    await dataSource.query(
      `INSERT INTO surgery_request_quotations (surgery_request_id, supplier_id, proposal_number, total_value, submission_date, valid_until, selected)
       VALUES ($1,$2,'COT-SYN-2024-778',24500.00,NOW() - INTERVAL '6 days',NOW() + INTERVAL '24 days',false)`,
      [r[0].id, supplierIds[2]],
    );
  }

  // SR 11 — Dra. Fernanda Rocha — paciente 6 — PENDING
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, diagnosis, medical_report, patient_history, surgery_description, health_plan_registration, health_plan_type)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,1,2,NULL,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        collabMedicaId,
        assistente2Id,
        patientIds2[6],
        hospitalIds[2],
        healthPlanIds[3],
        procedureIds[19],
        'Espondilolistese degenerativa L4-L5 grau II com estenose do canal vertebral e síndrome de cauda equina incipiente.',
        'RM revela listese grau II com estenose foraminal bilateral. Déficit neurológico progressivo.',
        'Sem comorbidades cardiovasculares. Tabagismo cessante há 3 anos. ASA II.',
        'Artrodese posterolateral L4-L5 com instrumentação pedicular bilateral e descompressão canal.',
        '5647382910',
        'Apartamento',
      ],
    );
    srIds2.push(r[0].id);
  }

  logger.log(`  ✅ ${srIds2.length} solicitações criadas para conta 2\n`);

  // ========================================
  // 14. SOLICITAÇÕES CIRÚRGICAS — Conta 1 (medico@inexci.com)
  // ========================================
  logger.log('📋 Criando solicitações cirúrgicas (conta 1)...');

  const srIds1: string[] = [];

  // SR C1-1 — ATJ — SCHEDULED
  {
    const surgDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, diagnosis, medical_report, patient_history, surgery_description, health_plan_registration, health_plan_type, sent_at, analysis_started_at, health_plan_protocol, surgery_date, hospital_protocol)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,5,3,true,$7,$8,$9,$10,$11,$12,NOW() - INTERVAL '30 days',NOW() - INTERVAL '27 days','UNIMED-20241087',$13,'HEIN-2024-5531') RETURNING id`,
      [
        adminMedicoId,
        adminMedicoId,
        patientIds1[0],
        hospitalIds[3],
        healthPlanIds[4],
        procedureIdsConta1[4],
        'Gonartrose bilateral grau IV (KL). Dor intensa e incapacitante bilateral. Sem resposta a tratamento clínico e infiltrações.',
        'Paciente 64 anos com artrose avançada dos joelhos. Cintilografia óssea com hipercaptação bilateral. Indicação absoluta de ATJ.',
        'HAS, DM2. Risco cirúrgico baixo (cardiologista). IMC 28. Sem antecedentes de TVP.',
        'Artroplastia total do joelho direito com prótese de superfície cimentada. Uso de torniquete, acesso medial parapatelar.',
        '1122334455',
        'Apartamento',
        surgDate,
      ],
    );
    srIds1.push(r[0].id);
    for (const [p, n] of [
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ])
      await recordStatusChange(dataSource, r[0].id, p, n);
    const opmeC1a = await dataSource.query(
      `INSERT INTO opme_items (surgery_request_id, name, brand, quantity, authorized_quantity) VALUES ($1,'Prótese total de joelho Triathlon - tamanho 5','Stryker',1,1) RETURNING id`,
      [r[0].id],
    );
    await dataSource.query(
      `INSERT INTO opme_item_suppliers (opme_item_id, supplier_id) VALUES ($1,$2)`,
      [opmeC1a[0].id, supplierIds[3]],
    );
    const opmeC1b = await dataSource.query(
      `INSERT INTO opme_items (surgery_request_id, name, brand, quantity, authorized_quantity) VALUES ($1,'Polia tibial ultracongruente','Stryker',1,1) RETURNING id`,
      [r[0].id],
    );
    await dataSource.query(
      `INSERT INTO opme_item_suppliers (opme_item_id, supplier_id) VALUES ($1,$2)`,
      [opmeC1b[0].id, supplierIds[3]],
    );
    const opmeC1c = await dataSource.query(
      `INSERT INTO opme_items (surgery_request_id, name, brand, quantity, authorized_quantity) VALUES ($1,'Cimento ósseo com antibiótico 40g','Palacos',2,2) RETURNING id`,
      [r[0].id],
    );
    await dataSource.query(
      `INSERT INTO opme_item_suppliers (opme_item_id, supplier_id) VALUES ($1,$2)`,
      [opmeC1c[0].id, supplierIds[4]],
    );
    await dataSource.query(
      `INSERT INTO surgery_request_quotations (surgery_request_id, supplier_id, proposal_number, total_value, submission_date, valid_until, selected)
       VALUES ($1,$2,'COT-ZIM-2024-221',21500.00,NOW() - INTERVAL '22 days',NOW() + INTERVAL '8 days',true)`,
      [r[0].id, supplierIds[3]],
    );
    await dataSource.query(
      `INSERT INTO surgery_request_quotations (surgery_request_id, supplier_id, proposal_number, total_value, submission_date, valid_until, selected)
       VALUES ($1,$2,'COT-DEP-2024-445',23200.00,NOW() - INTERVAL '20 days',NOW() + INTERVAL '10 days',false)`,
      [r[0].id, supplierIds[4]],
    );
  }

  // SR C1-2 — ATQ urgente — IN_SCHEDULING
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, diagnosis, medical_report, patient_history, surgery_description, health_plan_registration, health_plan_type, sent_at, analysis_started_at, health_plan_protocol, date_options)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,4,4,true,$7,$8,$9,$10,$11,$12,NOW() - INTERVAL '5 days',NOW() - INTERVAL '3 days','PORTO-20240777',$13) RETURNING id`,
      [
        adminMedicoId,
        assistenteOrtId,
        patientIds1[1],
        hospitalIds[3],
        healthPlanIds[5],
        procedureIdsConta1[7],
        'Fratura do colo do fêmur direito Garden III em paciente idosa. Queda da própria altura em domicílio.',
        'RX confirma fratura do colo femoral direito deslocada. Indicação de tratamento cirúrgico de urgência.',
        'Osteoporose severa. HAS. Uso de anticoagulantes (suspenso). Risco cirúrgico moderado (ASA III).',
        'Artroplastia total do quadril direito cimentada. Via póstero-lateral. Prótese cimentada com cimento antibiótico.',
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
    for (const [p, n] of [
      [1, 2],
      [2, 3],
      [3, 4],
    ])
      await recordStatusChange(dataSource, r[0].id, p, n);
    const opmeC2a = await dataSource.query(
      `INSERT INTO opme_items (surgery_request_id, name, brand, quantity) VALUES ($1,'Prótese total de quadril cimentada - haste 12','DePuy Corail',1) RETURNING id`,
      [r[0].id],
    );
    await dataSource.query(
      `INSERT INTO opme_item_suppliers (opme_item_id, supplier_id) VALUES ($1,$2)`,
      [opmeC2a[0].id, supplierIds[4]],
    );
    const opmeC2b = await dataSource.query(
      `INSERT INTO opme_items (surgery_request_id, name, brand, quantity) VALUES ($1,'Cimento ósseo Palacos R 40g','Heraeus',3) RETURNING id`,
      [r[0].id],
    );
    await dataSource.query(
      `INSERT INTO opme_item_suppliers (opme_item_id, supplier_id) VALUES ($1,$2)`,
      [opmeC2b[0].id, supplierIds[4]],
    );
  }

  // SR C1-3 — Artroscopia — PENDING
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, diagnosis, medical_report, patient_history, surgery_description, health_plan_registration, health_plan_type)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,1,2,false,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        adminMedicoId,
        adminMedicoId,
        patientIds1[3],
        hospitalIds[4],
        healthPlanIds[4],
        procedureIdsConta1[5],
        'Lesão meniscal medial posterior direita em paciente jovem e ativa. RNM confirma rotura complexa.',
        'Paciente com dor medial no joelho após torção durante corrida. RNM: rotura complexa de menisco medial. Bloqueio articular intermitente.',
        'ASA I. Atleta amadora. Sem comorbidades.',
        'Artroscopia diagnóstica e terapêutica com meniscectomia parcial ou sutura meniscal conforme avaliação intraoperatória.',
        '7766554433',
        'Apartamento',
      ],
    );
    srIds1.push(r[0].id);
  }

  // SR C1-4 — FINALIZED com billing e contestação
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, diagnosis, medical_report, patient_history, surgery_description, health_plan_registration, health_plan_type, sent_at, surgery_performed_at)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,8,2,true,$7,$8,$9,$10,$11,$12,NOW() - INTERVAL '120 days',NOW() - INTERVAL '80 days') RETURNING id`,
      [
        adminMedicoId,
        assistenteOrtId,
        patientIds1[2],
        hospitalIds[4],
        healthPlanIds[6],
        procedureIdsConta1[4],
        'Gonartrose severa unilateral esquerda com deformidade em varo. Falha do tratamento conservador por 2 anos.',
        'Paciente com artrose avançada do joelho esquerdo. Deformidade em varo de 12 graus. RX: pinçamento total.',
        'Sem comorbidades. ASA I. IMC 23. Bom estado geral.',
        'ATJ esquerda com correção de deformidade em varo.',
        '4433221100',
        'Enfermaria',
      ],
    );
    srIds1.push(r[0].id);
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
      `INSERT INTO opme_items (surgery_request_id, name, brand, quantity, authorized_quantity) VALUES ($1,'Prótese total de joelho Persona - tamanho C','Zimmer Biomet',1,0) RETURNING id`,
      [r[0].id],
    );
    await dataSource.query(
      `INSERT INTO opme_item_suppliers (opme_item_id, supplier_id) VALUES ($1,$2)`,
      [opmeC4a[0].id, supplierIds[3]],
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
    await dataSource.query(
      `INSERT INTO report_sections (surgery_request_id, title, description, "order") VALUES ($1,'Histórico e Diagnóstico','<p>Paciente com gonartrose severa unilateral esquerda. Tratamento conservador sem resposta após 2 anos. RX confirma pinçamento articular total com deformidade em varo de 12 graus.</p>',1)`,
      [r[0].id],
    );
    await dataSource.query(
      `INSERT INTO report_sections (surgery_request_id, title, description, "order") VALUES ($1,'Conduta','<p>Indicada artroplastia total do joelho esquerdo. Implante autorizado pela operadora. Cirurgia realizada sem intercorrências. Alta no 3º PO.</p>',2)`,
      [r[0].id],
    );
  }

  // SR C1-5 — SENT (Enviada) — Eduardo Luiz Teixeira
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, diagnosis, medical_report, patient_history, surgery_description, health_plan_registration, health_plan_type, sent_at, send_method)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,2,2,false,$7,$8,$9,$10,$11,$12,NOW() - INTERVAL '4 days','email') RETURNING id`,
      [
        adminMedicoId,
        adminMedicoId,
        patientIds1[4],
        hospitalIds[3],
        healthPlanIds[4],
        procedureIdsConta1[19],
        'Espondilolistese degenerativa L4-L5 grau II com estenose foraminal e dor radicular bilateral. Sem resposta ao tratamento conservador por 18 meses.',
        'Paciente de 80 anos com lombalgia crônica irradiada para membros inferiores. RM confirma listese e estenose foraminal bilateral grave. Fisioterapia e bloqueio epidural sem resultado.',
        'Osteoporose severa. HAS controlada. Uso de bifosfonatos. Risco cirúrgico moderado (ASA III). Avaliação cardiológica favorável ao procedimento.',
        'Artrodese posterolateral L4-L5 com instrumentação pedicular bilateral e descompressão do canal vertebral.',
        '2211009988',
        'Apartamento',
      ],
    );
    srIds1.push(r[0].id);
    await recordStatusChange(dataSource, r[0].id, 1, 2, adminMedicoId);
  }

  // SR C1-6 — IN_ANALYSIS (Em Análise) — Fernando Augusto Costa (segunda cirurgia)
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, diagnosis, medical_report, patient_history, surgery_description, health_plan_registration, health_plan_type, sent_at, analysis_started_at)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,3,2,false,$7,$8,$9,$10,$11,$12,NOW() - INTERVAL '15 days',NOW() - INTERVAL '12 days') RETURNING id`,
      [
        adminMedicoId,
        assistenteOrtId,
        patientIds1[0],
        hospitalIds[4],
        healthPlanIds[5],
        procedureIdsConta1[1],
        'Hérnia inguinal bilateral volumosa com episódios de encarceramento. Indicação cirúrgica de urgência relativa.',
        'Paciente com abaulamento inguinal bilateral há 3 anos com progressão nos últimos 6 meses e dois episódios de encarceramento. Exame clínico confirma hérnia inguinal direta bilateral redutível.',
        'HAS controlada. DM2 compensada. ASA II. Avaliação pré-operatória em andamento.',
        'Herniorrafia inguinal bilateral com tela de polipropileno por via aberta (técnica de Lichtenstein bilateral).',
        '1122334455',
        'Apartamento',
      ],
    );
    srIds1.push(r[0].id);
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
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, diagnosis, medical_report, patient_history, surgery_description, health_plan_registration, health_plan_type, sent_at, analysis_started_at, health_plan_protocol, surgery_date, surgery_performed_at)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,6,3,true,$7,$8,$9,$10,$11,$12,NOW() - INTERVAL '55 days',NOW() - INTERVAL '52 days','UNIMED-20241243',NOW() - INTERVAL '20 days',NOW() - INTERVAL '20 days') RETURNING id`,
      [
        adminMedicoId,
        adminMedicoId,
        patientIds1[1],
        hospitalIds[3],
        healthPlanIds[4],
        procedureIdsConta1[17],
        'Catarata nuclear densa grau IV no olho direito. Acuidade visual inferior a 20/200 com piora progressiva nos últimos 6 meses.',
        'Paciente de 70 anos com redução progressiva da acuidade visual. Oftalmoscopia confirma catarata densa bilateral. Indicação de tratamento cirúrgico pelo olho direito.',
        'HAS controlada. Osteoporose. Uso de anticoagulantes suspensos 5 dias antes do procedimento. ASA II.',
        'Facoemulsificação com implante de LIO monofocal no olho direito. Anestesia tópica com sedação leve.',
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
      `INSERT INTO opme_items (surgery_request_id, name, brand, quantity, authorized_quantity) VALUES ($1,'Lente intraocular monofocal AcrySof IQ','Alcon',1,1) RETURNING id`,
      [r[0].id],
    );
    await dataSource.query(
      `INSERT INTO opme_item_suppliers (opme_item_id, supplier_id) VALUES ($1,$2)`,
      [opmeC7a[0].id, supplierIds[3]],
    );
    await dataSource.query(
      `INSERT INTO report_sections (surgery_request_id, title, description, "order") VALUES ($1,'Diagnóstico e Indicação','<p>Paciente com catarata nuclear densa grau IV no olho direito. Acuidade visual inferior a 20/200. Indicação de facoemulsificação com implante de LIO.</p>',1)`,
      [r[0].id],
    );
    await dataSource.query(
      `INSERT INTO report_sections (surgery_request_id, title, description, "order") VALUES ($1,'Procedimento Realizado','<p>Facoemulsificação realizada sem intercorrências. LIO implantada em posição correta. Alta no mesmo dia. Olho esquerdo a ser operado em 60 dias.</p>',2)`,
      [r[0].id],
    );
  }

  // SR C1-8 — INVOICED (Faturada) — Marcos Antônio Ribeiro (segunda cirurgia)
  {
    const r = await dataSource.query(
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, diagnosis, medical_report, patient_history, surgery_description, health_plan_registration, health_plan_type, sent_at, surgery_performed_at)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,7,1,false,$7,$8,$9,$10,$11,$12,NOW() - INTERVAL '65 days',NOW() - INTERVAL '35 days') RETURNING id`,
      [
        adminMedicoId,
        assistenteOrtId,
        patientIds1[2],
        hospitalIds[4],
        healthPlanIds[4],
        procedureIdsConta1[18],
        'Desvio septal esquerdo grau III com obstrução nasal crônica e hipertrofia de cornetos inferiores bilaterais.',
        'Paciente com obstrução nasal crônica bilateral predominante à esquerda há 4 anos. Sem resposta a corticosteroides tópicos por 6 meses. Desvio septal confirmado por rinoscopia.',
        'Sem comorbidades. ASA I. Exames pré-operatórios normais.',
        'Rinoplastia funcional com septoplastia e turbinoplastia por redução. Anestesia geral.',
        '4433221100',
        'Enfermaria',
      ],
    );
    srIds1.push(r[0].id);
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
      `INSERT INTO surgery_requests (doctor_id, owner_id, created_by_id, patient_id, hospital_id, health_plan_id, procedure_id, status, priority, has_opme, diagnosis, medical_report, patient_history, surgery_description, health_plan_registration, health_plan_type, sent_at, cancel_reason, closed_at)
       VALUES ($1,(SELECT owner_id FROM users WHERE id = $1),$2,$3,$4,$5,$6,9,2,false,$7,$8,$9,$10,$11,$12,NOW() - INTERVAL '35 days','Convênio negou autorização por carência contratual do plano. Paciente optou por reagendamento após período de carência.',NOW() - INTERVAL '10 days') RETURNING id`,
      [
        adminMedicoId,
        adminMedicoId,
        patientIds1[3],
        hospitalIds[4],
        healthPlanIds[6],
        procedureIdsConta1[10],
        'Nódulo tireoidiano sólido de 2,8 cm com PAAF indeterminada (Bethesda IV). Indicação de tireoidectomia total para diagnóstico definitivo e tratamento.',
        'Paciente com nódulo tireoidiano palpável identificado há 6 meses. USG confirma nódulo sólido hipoecogênico de 2,8 cm. PAAF: neoplasia folicular (Bethesda IV).',
        'Sem comorbidades. ASA I. Avaliação laringoscópica normal.',
        'Tireoidectomia total com linfadenectomia do compartimento central por cervicotomia.',
        '7766554433',
        'Apartamento',
      ],
    );
    srIds1.push(r[0].id);
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
        `INSERT INTO opme_items (surgery_request_id, name, brand, quantity, authorized_quantity)
         VALUES ($1, $2, $3, 1, 1) RETURNING id`,
        [sr.id, `Kit OPME padrão - ${procedureName}`, 'Padrão Seed'],
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
        procedure_id: procedureIdsConta1[4],
        procedure: { id: procedureIdsConta1[4], name: procedureNames[4] },
        procedureName: procedureNames[4],
        procedure_name: procedureNames[4],
        opme_items: [
          {
            name: 'Prótese total de joelho cimentada',
            brand: 'Stryker Triathlon',
            quantity: 1,
          },
          {
            name: 'Cimento ósseo com antibiótico 40g',
            brand: 'Palacos',
            quantity: 2,
          },
        ],
        required_documents: [
          'personal_document',
          'doctor_request',
          'medical_report',
          'preoperative_exams',
        ],
        required_exams: [
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
        procedure_id: procedureIdsConta1[5],
        procedure: { id: procedureIdsConta1[5], name: procedureNames[5] },
        procedureName: procedureNames[5],
        procedure_name: procedureNames[5],
        opme_items: [],
        required_documents: [
          'personal_document',
          'doctor_request',
          'medical_report',
        ],
        required_exams: ['RNM joelho', 'Hemograma', 'Coagulograma'],
      }),
      3,
    ],
  );
  await dataSource.query(
    `INSERT INTO surgery_request_templates (doctor_id, owner_id, name, template_data, usage_count) VALUES ($1, (SELECT owner_id FROM users WHERE id = $1), $2, $3, $4)`,
    [
      adminId,
      'Revascularização Miocárdica',
      JSON.stringify({
        procedure_id: procedureIds[12],
        procedure: { id: procedureIds[12], name: procedureNames[12] },
        procedureName: procedureNames[12],
        procedure_name: procedureNames[12],
        opme_items: [
          {
            name: 'Oxigenador de membrana',
            brand: 'Sorin Group',
            quantity: 1,
          },
        ],
        required_documents: [
          'personal_document',
          'doctor_request',
          'medical_report',
          'preoperative_exams',
          'cardiac_evaluation',
        ],
        required_exams: [
          'Coronariografia',
          'Ecocardiograma',
          'Cintilografia miocárdica',
          'Hemograma completo',
        ],
      }),
      2,
    ],
  );
  await dataSource.query(
    `INSERT INTO surgery_request_templates (doctor_id, owner_id, name, template_data, usage_count) VALUES ($1, (SELECT owner_id FROM users WHERE id = $1), $2, $3, $4)`,
    [
      collabMedicaId,
      'Discectomia Lombar',
      JSON.stringify({
        procedure_id: procedureIds[6],
        procedure: { id: procedureIds[6], name: procedureNames[6] },
        procedureName: procedureNames[6],
        procedure_name: procedureNames[6],
        opme_items: [
          {
            name: 'Cage intersomático TLIF PEEK',
            brand: 'Medtronic',
            quantity: 1,
          },
          {
            name: 'Parafusos pediculares (kit 4)',
            brand: 'Synthes',
            quantity: 1,
          },
        ],
        required_documents: [
          'personal_document',
          'doctor_request',
          'medical_report',
          'preoperative_exams',
        ],
        required_exams: [
          'RNM coluna lombar',
          'EMG membros inferiores',
          'Hemograma',
          'Risco cirúrgico',
        ],
      }),
      5,
    ],
  );

  logger.log('  ✅ 4 templates criados\n');

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
    [srIds1[0], assistenteOrtId],
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

  // SR2 conta 2
  await dataSource.query(
    `INSERT INTO surgery_request_activities (surgery_request_id, user_id, type, content) VALUES ($1, $2, 'status_change', 'Status alterado de Pendente para Enviada')`,
    [srIds2[1], assistente1Id],
  );
  await dataSource.query(
    `INSERT INTO surgery_request_activities (surgery_request_id, user_id, type, content) VALUES ($1, $2, 'comment', 'Solicitação enviada por e-mail ao convênio Amil.')`,
    [srIds2[1], assistente1Id],
  );

  // SR10 — Dra. Fernanda
  await dataSource.query(
    `INSERT INTO surgery_request_activities (surgery_request_id, user_id, type, content) VALUES ($1, $2, 'system', 'Solicitação criada com OPME. Aguardando cotação.')`,
    [srIds2[9], collabMedicaId],
  );
  await dataSource.query(
    `INSERT INTO surgery_request_activities (surgery_request_id, user_id, type, content) VALUES ($1, $2, 'comment', 'Cotação da Synthes recebida. Valor R$ 24.500,00. Aguardando aprovação do convênio.')`,
    [srIds2[9], collabMedicaId],
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
    [[adminMedicoId, adminId, collabMedicaId]],
  );
  for (const dp of doctorProfileRows) {
    await dataSource.query(
      `INSERT INTO doctor_headers (doctor_profile_id, logo_url, logo_position, content_html)
       VALUES ($1, $2, 'left', $3)
       ON CONFLICT (doctor_profile_id) DO NOTHING`,
      [
        dp.id,
        `https://storage.inexci.com/headers/logo-${dp.user_id}.png`,
        `<p><strong>Clínica</strong> — Cabeçalho padrão para o perfil médico ${dp.user_id}</p>`,
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
  logger.log('  • 2 contas independentes (tenant isolation via owner_id)');
  logger.log('  • 7 usuários (2 admins/médicos + 5 colaboradores)');
  logger.log('  • 2 subscriptions ativas (plano Profissional)');
  logger.log('  • 5 hospitais (3 RJ, 2 SP) com endereços reais');
  logger.log('  • 7 convênios com contatos de autorização');
  logger.log('  • 5 fornecedores de OPME');
  logger.log(
    '  • 13 pacientes com dados completos (endereço, convênio, histórico)',
  );
  logger.log(
    '  • 20 solicitações cirúrgicas (todos os 9 status cobertos nas 2 contas)',
  );
  logger.log(
    '  • OPME, cotações, análises, faturamentos, contestações, laudos',
  );
  logger.log('  • 4 templates de solicitação');
  logger.log('  • Atividades (comentários, mudanças de status, sistema)');
  logger.log(
    '  • 3 cabeçalhos de médico (doctor_headers — 1 por perfil médico)',
  );
  logger.log('');
  logger.log('🔐 Credenciais (todos com senha: 123456):');
  logger.log('  ┌─────────────────────────────────────────────────────────┐');
  logger.log('  │ CONTA 1 (Ortopedia — São Paulo)                         │');
  logger.log('  │  medico@inexci.com        Admin + Médico (Ortopedia)    │');
  logger.log('  │  assistente.ort@inexci.com  Assistente                  │');
  logger.log('  ├─────────────────────────────────────────────────────────┤');
  logger.log('  │ CONTA 2 (Cardiologia/Neurocirurgia — Rio de Janeiro)    │');
  logger.log('  │  admin@inexci.com          Admin + Médico (Cardiologia) │');
  logger.log('  │  medica@inexci.com          Médica colaboradora (Neuro) │');
  logger.log('  │  assistente1@inexci.com     Assistente (admin + medica) │');
  logger.log('  │  assistente2@inexci.com     Assistente (apenas medica)  │');
  logger.log('  │  secretaria@inexci.com      Assistente (pendente)       │');
  logger.log('  └─────────────────────────────────────────────────────────┘');

  await dataSource.destroy();
  process.exit(0);
}

main().catch((error) => {
  logger.error('❌ Erro durante o seed:', error);
  process.exit(1);
});
