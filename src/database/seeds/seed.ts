import * as bcrypt from 'bcrypt';
import { faker } from '@faker-js/faker';
import { Logger } from '@nestjs/common';
import { SeedDataSource } from '../typeorm/seed-data-source';

const logger = new Logger('Seed');

/**
 * 🌱 SEED v3 — Nova estrutura de usuários e permissões
 *
 * Arquitetura:
 * - role: 'admin' | 'collaborator' (médico = existência de doctor_profile)
 * - account_id: isolamento de tenant (todos da mesma conta compartilham)
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

async function main() {
  checkEnvironment();

  logger.log('🌱 Iniciando seed do banco de dados (v3 — Nova Estrutura)...');
  logger.log('⏳ Este processo pode levar alguns minutos...\n');

  const dataSource = await SeedDataSource.initialize();
  const hashedPassword = await bcrypt.hash('123456', 10);

  // ========================================
  // 1. PLANOS DE ASSINATURA
  // ========================================
  logger.log('📋 Criando planos de assinatura...');

  const basicPlan = await dataSource.query(`
    INSERT INTO subscription_plan (name, description, max_doctors, is_active)
    VALUES ('Básico', 'Plano básico com 1 CRM permitido', 1, true)
    RETURNING id
  `);
  const basicPlanId = basicPlan[0].id;

  const professionalPlan = await dataSource.query(`
    INSERT INTO subscription_plan (name, description, max_doctors, is_active)
    VALUES ('Profissional', 'Plano profissional com até 10 CRMs permitidos', 10, true)
    RETURNING id
  `);
  const professionalPlanId = professionalPlan[0].id;

  logger.log('✅ 2 planos de assinatura criados\n');

  // ========================================
  // 2. PROCEDIMENTOS
  // ========================================
  logger.log('🔧 Criando procedimentos...');

  const procedureNames = [
    'Colecistectomia videolaparoscópica',
    'Herniorrafia inguinal',
    'Apendicectomia',
    'Artroplastia total do joelho',
    'Artroscopia de joelho',
    'Discectomia lombar',
    'Artroplastia total do quadril',
    'Herniorrafia umbilical',
    'Nefrolitotripsia percutânea',
    'Septoplastia',
  ];

  const procedureIds: string[] = [];
  for (const name of procedureNames) {
    const result = await dataSource.query(
      `INSERT INTO procedure (name) VALUES ($1) RETURNING id`,
      [name],
    );
    procedureIds.push(result[0].id);
  }
  logger.log(`✅ ${procedureIds.length} procedimentos criados\n`);

  // ========================================
  // 3. ADMIN (médico — tem doctor_profile)
  // ========================================
  logger.log('👤 Criando admin (médico principal)...');

  // Para admin, account_id = self.id (auto-referência).
  // Como a FK account_id → user.id impede inserir com UUID inexistente,
  // pré-geramos o UUID e usamos no INSERT.
  const preGeneratedId = await dataSource.query(
    `SELECT uuid_generate_v4() AS id`,
  );
  const adminId = preGeneratedId[0].id;

  await dataSource.query(
    `
    INSERT INTO "user" (id, name, email, password, phone, cpf, gender, birth_date, role, status, account_id, admin_id, subscription_plan_id)
    VALUES (
      $1,
      'Dr. Carlos Silva',
      'admin@inexci.com',
      $2,
      '${generatePhone()}',
      '${generateCPF()}',
      'M',
      '1975-05-15',
      'admin',
      'active',
      $1,
      NULL,
      $3
    )
  `,
    [adminId, hashedPassword, professionalPlanId],
  );

  // Criar doctor_profile para o admin
  await dataSource.query(
    `
    INSERT INTO doctor_profile (user_id, crm, crm_state, specialty, clinic_name, clinic_cnpj, clinic_address)
    VALUES ($1, '123456', 'SP', 'Ortopedia', 'Clínica Ortopédica Silva', '${generateCNPJ()}', 'Rua das Flores, 123 - São Paulo, SP')
  `,
    [adminId],
  );

  logger.log('  ✅ Admin criado: admin@inexci.com (médico, Ortopedia)\n');

  // ========================================
  // 4. COLLABORATORS
  // ========================================
  logger.log('👩‍💼 Criando colaboradores...');

  // Collaborator A: tem doctor_profile (médico da equipe)
  const collabAResult = await dataSource.query(
    `
    INSERT INTO "user" (name, email, password, phone, cpf, gender, birth_date, role, status, account_id, admin_id)
    VALUES (
      'Dra. Mariana Costa',
      'medica@inexci.com',
      $1,
      '${generatePhone()}',
      '${generateCPF()}',
      'F',
      '1982-08-22',
      'collaborator',
      'active',
      $2,
      $2
    )
    RETURNING id
  `,
    [hashedPassword, adminId],
  );
  const collabAId = collabAResult[0].id;

  // Criar doctor_profile para collaborator A
  await dataSource.query(
    `
    INSERT INTO doctor_profile (user_id, crm, crm_state, specialty, clinic_name, clinic_cnpj)
    VALUES ($1, '654321', 'RJ', 'Cardiologia', 'Clínica Cardíaca Costa', '${generateCNPJ()}')
  `,
    [collabAId],
  );

  logger.log('  ➕ Collaborator A: medica@inexci.com (médica, Cardiologia)');

  // Collaborator B: sem doctor_profile (assistente)
  const collabBResult = await dataSource.query(
    `
    INSERT INTO "user" (name, email, password, phone, cpf, gender, birth_date, role, status, account_id, admin_id)
    VALUES (
      'Ana Paula Oliveira',
      'assistente1@inexci.com',
      $1,
      '${generatePhone()}',
      '${generateCPF()}',
      'F',
      '1990-03-10',
      'collaborator',
      'active',
      $2,
      $2
    )
    RETURNING id
  `,
    [hashedPassword, adminId],
  );
  const collabBId = collabBResult[0].id;

  logger.log('  ➕ Collaborator B: assistente1@inexci.com (assistente)');

  // Collaborator C: sem doctor_profile (assistente)
  const collabCResult = await dataSource.query(
    `
    INSERT INTO "user" (name, email, password, phone, cpf, gender, birth_date, role, status, account_id, admin_id)
    VALUES (
      'João Pedro Lima',
      'assistente2@inexci.com',
      $1,
      '${generatePhone()}',
      '${generateCPF()}',
      'M',
      '1995-07-25',
      'collaborator',
      'active',
      $2,
      $2
    )
    RETURNING id
  `,
    [hashedPassword, adminId],
  );
  const collabCId = collabCResult[0].id;

  logger.log('  ➕ Collaborator C: assistente2@inexci.com (assistente)');
  logger.log('  ✅ 3 colaboradores criados\n');

  // ========================================
  // 5. VÍNCULOS user_doctor_access
  // ========================================
  logger.log('🔗 Criando vínculos de acesso...');

  // Collaborator B → acesso ao Admin (médico) + Collaborator A (médico)
  await dataSource.query(
    `
    INSERT INTO user_doctor_access (user_id, doctor_user_id, status, created_by_id)
    VALUES ($1, $2, 'active', $3)
  `,
    [collabBId, adminId, adminId],
  );

  await dataSource.query(
    `
    INSERT INTO user_doctor_access (user_id, doctor_user_id, status, created_by_id)
    VALUES ($1, $2, 'active', $3)
  `,
    [collabBId, collabAId, adminId],
  );

  logger.log('  ➕ Collaborator B → acesso ao Admin + Collaborator A');

  // Collaborator C → acesso apenas ao Collaborator A (médico)
  await dataSource.query(
    `
    INSERT INTO user_doctor_access (user_id, doctor_user_id, status, created_by_id)
    VALUES ($1, $2, 'active', $3)
  `,
    [collabCId, collabAId, adminId],
  );

  logger.log('  ➕ Collaborator C → acesso apenas ao Collaborator A');
  logger.log('  ✅ Vínculos criados\n');

  // ========================================
  // 6. HOSPITAIS (vinculados ao admin-médico)
  // ========================================
  logger.log('🏥 Criando hospitais...');

  const hospitalData = [
    { name: 'Hospital São Lucas', city: 'São Paulo', state: 'SP' },
    { name: 'Hospital Santa Maria', city: 'Rio de Janeiro', state: 'RJ' },
  ];

  const hospitalIds: string[] = [];
  for (const data of hospitalData) {
    const result = await dataSource.query(
      `
      INSERT INTO hospital (name, cnpj, email, phone, city, state, active, doctor_id)
      VALUES ($1, $2, $3, $4, $5, $6, true, $7)
      RETURNING id
    `,
      [
        data.name,
        generateCNPJ(),
        faker.internet.email({ provider: 'hospital.com.br' }),
        generatePhone(),
        data.city,
        data.state,
        adminId,
      ],
    );
    hospitalIds.push(result[0].id);
  }
  logger.log(`  ✅ ${hospitalIds.length} hospitais criados\n`);

  // ========================================
  // 7. CONVÊNIOS (vinculados ao admin-médico)
  // ========================================
  logger.log('💳 Criando convênios...');

  const healthPlanData = [
    { name: 'Unimed', ans_code: '301337' },
    { name: 'Amil', ans_code: '326305' },
  ];

  const healthPlanIds: string[] = [];
  for (const data of healthPlanData) {
    const result = await dataSource.query(
      `
      INSERT INTO health_plan (name, ans_code, cnpj, email, phone, active, doctor_id)
      VALUES ($1, $2, $3, $4, $5, true, $6)
      RETURNING id
    `,
      [
        data.name,
        data.ans_code,
        generateCNPJ(),
        faker.internet.email({ provider: 'plano.com.br' }),
        generatePhone(),
        adminId,
      ],
    );
    healthPlanIds.push(result[0].id);
  }
  logger.log(`  ✅ ${healthPlanIds.length} convênios criados\n`);

  // ========================================
  // 8. FORNECEDORES (vinculados ao admin-médico)
  // ========================================
  logger.log('📦 Criando fornecedores...');

  const supplierResult = await dataSource.query(
    `
    INSERT INTO supplier (name, cnpj, email, phone, active, doctor_id)
    VALUES ($1, $2, $3, $4, true, $5)
    RETURNING id
  `,
    [
      'Medical Supplies Ltda',
      generateCNPJ(),
      faker.internet.email({ provider: 'supplier.com.br' }),
      generatePhone(),
      adminId,
    ],
  );
  const supplierId = supplierResult[0].id;
  logger.log('  ✅ 1 fornecedor criado\n');

  // ========================================
  // 9. PACIENTES
  // ========================================
  logger.log('🧑‍🤝‍🧑 Criando pacientes...');

  // 2 pacientes do admin-médico
  const patientIds: string[] = [];
  const adminPatients = [
    {
      name: 'Maria da Silva',
      email: 'maria@email.com',
      gender: 'F',
      birth: '1960-03-15',
    },
    {
      name: 'José Santos',
      email: 'jose@email.com',
      gender: 'M',
      birth: '1975-11-20',
    },
  ];

  for (const p of adminPatients) {
    const result = await dataSource.query(
      `
      INSERT INTO patient (doctor_id, name, email, phone, cpf, gender, birth_date, health_plan_id, health_plan_number, active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
      RETURNING id
    `,
      [
        adminId,
        p.name,
        p.email,
        generatePhone(),
        generateCPF(),
        p.gender,
        p.birth,
        healthPlanIds[0],
        faker.string.numeric(10),
      ],
    );
    patientIds.push(result[0].id);
  }

  // 1 paciente do collaborator A (médico)
  const collabAPatientResult = await dataSource.query(
    `
    INSERT INTO patient (doctor_id, name, email, phone, cpf, gender, birth_date, health_plan_id, health_plan_number, active)
    VALUES ($1, $2, $3, $4, $5, 'M', '1988-06-10', $6, $7, true)
    RETURNING id
  `,
    [
      collabAId,
      'Pedro Ferreira',
      'pedro@email.com',
      generatePhone(),
      generateCPF(),
      healthPlanIds[1],
      faker.string.numeric(10),
    ],
  );
  patientIds.push(collabAPatientResult[0].id);

  logger.log(`  ✅ ${patientIds.length} pacientes criados\n`);

  // ========================================
  // 10. SOLICITAÇÕES CIRÚRGICAS
  // ========================================
  logger.log('📋 Criando solicitações cirúrgicas...');

  // 2 solicitações do admin-médico
  for (let i = 0; i < 2; i++) {
    await dataSource.query(
      `
      INSERT INTO surgery_request (
        doctor_id, created_by_id, patient_id, hospital_id, health_plan_id,
        procedure_id, status, priority, diagnosis, medical_report, surgery_description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `,
      [
        adminId,
        adminId,
        patientIds[i],
        hospitalIds[i % hospitalIds.length],
        healthPlanIds[i % healthPlanIds.length],
        procedureIds[i],
        i === 0 ? 1 : 2, // PENDING e SENT
        2, // MEDIUM
        `Diagnóstico do paciente ${i + 1}`,
        `Laudo médico do paciente ${i + 1}`,
        `Descrição cirúrgica do paciente ${i + 1}`,
      ],
    );
  }

  // 1 solicitação do collaborator A (médico)
  await dataSource.query(
    `
    INSERT INTO surgery_request (
      doctor_id, created_by_id, patient_id, hospital_id, health_plan_id,
      procedure_id, status, priority, diagnosis, medical_report, surgery_description
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `,
    [
      collabAId,
      collabAId,
      patientIds[2],
      hospitalIds[0],
      healthPlanIds[1],
      procedureIds[2],
      1, // PENDING
      3, // HIGH
      'Diagnóstico do paciente 3',
      'Laudo médico do paciente 3',
      'Descrição cirúrgica do paciente 3',
    ],
  );

  logger.log('  ✅ 3 solicitações cirúrgicas criadas\n');

  // ========================================
  // 11. NOTIFICATION SETTINGS
  // ========================================
  logger.log('🔔 Criando configurações de notificação...');

  const allUserIds = [adminId, collabAId, collabBId, collabCId];
  for (const userId of allUserIds) {
    await dataSource.query(
      `
      INSERT INTO user_notification_settings (user_id)
      VALUES ($1)
    `,
      [userId],
    );
  }
  logger.log(`  ✅ ${allUserIds.length} configurações criadas\n`);

  // ========================================
  // RESUMO
  // ========================================
  logger.log('═══════════════════════════════════════════════');
  logger.log('🎉 Seed v3 concluído com sucesso!');
  logger.log('═══════════════════════════════════════════════');
  logger.log('');
  logger.log('📊 Dados criados:');
  logger.log('  • 2 planos de assinatura (Básico, Profissional)');
  logger.log('  • 10 procedimentos');
  logger.log('  • 1 admin (admin@inexci.com) — médico, Ortopedia');
  logger.log('  • 3 colaboradores:');
  logger.log('    - medica@inexci.com — médica, Cardiologia');
  logger.log('    - assistente1@inexci.com — assistente');
  logger.log('    - assistente2@inexci.com — assistente');
  logger.log('  • 3 vínculos de acesso (user_doctor_access)');
  logger.log('  • 2 hospitais, 2 convênios, 1 fornecedor');
  logger.log('  • 3 pacientes, 3 solicitações cirúrgicas');
  logger.log('');
  logger.log('🔐 Credenciais (todos com senha: 123456):');
  logger.log('  • admin@inexci.com      — Admin (médico)');
  logger.log('  • medica@inexci.com     — Collaborator A (médica)');
  logger.log('  • assistente1@inexci.com — Collaborator B (assistente)');
  logger.log('  • assistente2@inexci.com — Collaborator C (assistente)');
  logger.log('');
  logger.log('🔗 Regras de acesso esperadas:');
  logger.log('  • Admin → vê tudo da conta');
  logger.log(
    '  • Collaborator A (médica) → vê apenas suas próprias solicitações',
  );
  logger.log('  • Collaborator B → vê solicitações do Admin + Collaborator A');
  logger.log('  • Collaborator C → vê apenas solicitações do Collaborator A');

  await dataSource.destroy();
  process.exit(0);
}

main().catch((error) => {
  logger.error('❌ Erro durante o seed:', error);
  process.exit(1);
});
