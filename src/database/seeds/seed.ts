import * as bcrypt from 'bcrypt';
import { faker } from '@faker-js/faker';
import { SeedDataSource } from '../typeorm/seed-data-source';

// Importar entidades
import { User, UserRole, UserStatus } from '../entities/user.entity';
import {
  DoctorProfile,
  SubscriptionStatus,
} from '../entities/doctor-profile.entity';
import {
  TeamMember,
  TeamMemberRole,
  TeamMemberStatus,
} from '../entities/team-member.entity';
import { Patient } from '../entities/patient.entity';
import { Hospital } from '../entities/hospital.entity';
import { HealthPlan } from '../entities/health-plan.entity';
import { Supplier } from '../entities/supplier.entity';
import { Cid } from '../entities/cid.entity';
import { Procedure } from '../entities/procedure.entity';
import {
  SurgeryRequest,
  SurgeryRequestStatus,
  SurgeryRequestPriority,
} from '../entities/surgery-request.entity';
import { SurgeryRequestProcedure } from '../entities/surgery-request-procedure.entity';
import { OpmeItem } from '../entities/opme-item.entity';
import { Document } from '../entities/document.entity';
import { SurgeryRequestQuotation } from '../entities/surgery-request-quotation.entity';
import { StatusUpdate } from '../entities/status-update.entity';
import { Chat } from '../entities/chat.entity';
import { ChatMessage } from '../entities/chat-message.entity';
import { RecoveryCode } from '../entities/recovery-code.entity';
import { DefaultDocumentClinic } from '../entities/default-document-clinic.entity';
import {
  Notification,
  NotificationType,
} from '../entities/notification.entity';
import { UserNotificationSettings } from '../entities/user-notification-settings.entity';

/**
 * 🌱 SEED PARA NOVA ESTRUTURA DE DADOS
 *
 * Nova Arquitetura:
 * - USUÁRIOS (fazem login): Admin, Médico, Colaborador
 * - ENTIDADES DE NEGÓCIO (não fazem login): Paciente, Hospital, Plano de Saúde, Fornecedor
 * - RELAÇÃO MÉDICO-COLABORADOR: TeamMember com permissões granulares
 */

// Verificação de ambiente
function checkEnvironment() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const allowedEnvs = ['development', 'local', 'dev'];

  if (!allowedEnvs.includes(nodeEnv.toLowerCase())) {
    console.error(
      '❌ ERRO: Seed só pode ser executado em ambiente local ou de desenvolvimento!',
    );
    process.exit(1);
  }
  console.log(`✅ Ambiente verificado: ${nodeEnv}`);
}

// Função auxiliar para gerar CPF válido
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

// Função auxiliar para gerar CNPJ válido
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

  console.log('🌱 Iniciando seed do banco de dados (Nova Estrutura)...');
  console.log('⏳ Este processo pode levar alguns minutos...\n');

  const dataSource = await SeedDataSource.initialize();
  const hashedPassword = await bcrypt.hash('123456', 10);

  // Repositories
  const userRepo = dataSource.getRepository(User);
  const doctorProfileRepo = dataSource.getRepository(DoctorProfile);
  const teamMemberRepo = dataSource.getRepository(TeamMember);
  const patientRepo = dataSource.getRepository(Patient);
  const hospitalRepo = dataSource.getRepository(Hospital);
  const healthPlanRepo = dataSource.getRepository(HealthPlan);
  const supplierRepo = dataSource.getRepository(Supplier);
  const cidRepo = dataSource.getRepository(Cid);
  const procedureRepo = dataSource.getRepository(Procedure);
  const surgeryRequestRepo = dataSource.getRepository(SurgeryRequest);
  const surgeryRequestProcedureRepo = dataSource.getRepository(
    SurgeryRequestProcedure,
  );
  const opmeItemRepo = dataSource.getRepository(OpmeItem);
  const documentRepo = dataSource.getRepository(Document);
  const quotationRepo = dataSource.getRepository(SurgeryRequestQuotation);
  const statusUpdateRepo = dataSource.getRepository(StatusUpdate);
  const chatRepo = dataSource.getRepository(Chat);
  const chatMessageRepo = dataSource.getRepository(ChatMessage);
  const recoveryCodeRepo = dataSource.getRepository(RecoveryCode);
  const defaultDocRepo = dataSource.getRepository(DefaultDocumentClinic);
  const notificationRepo = dataSource.getRepository(Notification);
  const notificationSettingsRepo = dataSource.getRepository(
    UserNotificationSettings,
  );

  // ========================================
  // 1. DADOS BASE (CIDs e Procedimentos)
  // ========================================

  console.log('📋 Criando CIDs...');
  const cidData = [
    { id: 'K80.2', description: 'Cálculo vesícula biliar' },
    { id: 'K40.9', description: 'Hérnia inguinal' },
    { id: 'K35.8', description: 'Apendicite aguda' },
    { id: 'M17.1', description: 'Gonartrose primária' },
    { id: 'M23.2', description: 'Lesão de menisco' },
    { id: 'M51.1', description: 'Hérnia de disco lombar' },
    { id: 'M16.1', description: 'Coxartrose primária' },
    { id: 'K42.9', description: 'Hérnia umbilical' },
    { id: 'N20.0', description: 'Cálculo renal' },
    { id: 'J34.2', description: 'Desvio de septo nasal' },
  ];

  const cids: Cid[] = [];
  for (const data of cidData) {
    let cid = await cidRepo.findOne({ where: { id: data.id } });
    if (!cid) {
      cid = await cidRepo.save(cidRepo.create(data));
    }
    cids.push(cid);
  }
  console.log(`✅ ${cids.length} CIDs\n`);

  console.log('🔧 Criando procedimentos...');
  const procedureData = [
    { tuss_code: '31005039', name: 'Colecistectomia videolaparoscópica' },
    { tuss_code: '31009026', name: 'Herniorrafia inguinal' },
    { tuss_code: '31009034', name: 'Apendicectomia' },
    { tuss_code: '30715016', name: 'Artroplastia total do joelho' },
    { tuss_code: '30715024', name: 'Artroscopia de joelho' },
    { tuss_code: '30715032', name: 'Discectomia lombar' },
    { tuss_code: '30715040', name: 'Artroplastia total do quadril' },
    { tuss_code: '31009042', name: 'Herniorrafia umbilical' },
    { tuss_code: '31306030', name: 'Nefrolitotripsia percutânea' },
    { tuss_code: '30601050', name: 'Septoplastia' },
  ];

  const procedures: Procedure[] = [];
  for (const data of procedureData) {
    let procedure = await procedureRepo.findOne({
      where: { tuss_code: data.tuss_code },
    });
    if (!procedure) {
      procedure = await procedureRepo.save(
        procedureRepo.create({ ...data, active: true }),
      );
    }
    procedures.push(procedure);
  }
  console.log(`✅ ${procedures.length} procedimentos\n`);

  // ========================================
  // 2. USUÁRIOS (fazem login) - CRIAR ANTES DAS ENTIDADES
  // ========================================

  console.log('👨‍⚕️ Criando usuários médicos...');

  // Médico principal de teste
  let doctorUser = await userRepo.findOne({
    where: { email: 'medico@inexci.com' },
  });
  if (!doctorUser) {
    doctorUser = await userRepo.save(
      userRepo.create({
        role: UserRole.DOCTOR,
        status: UserStatus.ACTIVE,
        email: 'medico@inexci.com',
        password: hashedPassword,
        name: 'Dr. Carlos Silva',
        phone: generatePhone(),
        cpf: generateCPF(),
        gender: 'M',
        birth_date: new Date('1975-05-15'),
      }),
    );
    console.log('  ➕ Criado: medico@inexci.com');
  } else {
    console.log('  ✓ Existe: medico@inexci.com');
  }

  // Perfil do médico principal
  let doctorProfile = await doctorProfileRepo.findOne({
    where: { user_id: doctorUser.id },
  });
  if (!doctorProfile) {
    doctorProfile = await doctorProfileRepo.save(
      doctorProfileRepo.create({
        user_id: doctorUser.id,
        specialty: 'Ortopedia',
        crm: '123456',
        crm_state: 'SP',
        clinic_name: 'Clínica Ortopédica Silva',
        clinic_cnpj: generateCNPJ(),
        subscription_status: SubscriptionStatus.ACTIVE,
        subscription_plan: 'professional',
        max_requests_per_month: 100,
        max_team_members: 5,
      }),
    );
  }

  console.log('  ✅ Médico principal criado\n');

  // Médico secundário de teste (medico2)
  let doctorUser2 = await userRepo.findOne({
    where: { email: 'medico2@inexci.com' },
  });
  if (!doctorUser2) {
    doctorUser2 = await userRepo.save(
      userRepo.create({
        role: UserRole.DOCTOR,
        status: UserStatus.ACTIVE,
        email: 'medico2@inexci.com',
        password: hashedPassword,
        name: 'Dra. Mariana Costa',
        phone: generatePhone(),
        cpf: generateCPF(),
        gender: 'F',
        birth_date: new Date('1982-08-22'),
      }),
    );
    console.log('  ➕ Criado: medico2@inexci.com');
  } else {
    console.log('  ✓ Existe: medico2@inexci.com');
  }

  // Perfil do médico secundário
  const doctorProfile2 = await doctorProfileRepo.findOne({
    where: { user_id: doctorUser2.id },
  });
  if (!doctorProfile2) {
    await doctorProfileRepo.save(
      doctorProfileRepo.create({
        user_id: doctorUser2.id,
        specialty: 'Cardiologia',
        crm: '654321',
        crm_state: 'RJ',
        clinic_name: 'Clínica Cardíaca Costa',
        clinic_cnpj: generateCNPJ(),
        subscription_status: SubscriptionStatus.ACTIVE,
        subscription_plan: 'basic',
        max_requests_per_month: 50,
        max_team_members: 2,
      }),
    );
  }

  console.log('  ✅ Médico secundário criado\n');

  console.log('👩‍💼 Criando usuários colaboradores...');

  // Colaborador 1 - Gestor
  let collaborator1 = await userRepo.findOne({
    where: { email: 'colaborador@inexci.com' },
  });
  if (!collaborator1) {
    collaborator1 = await userRepo.save(
      userRepo.create({
        role: UserRole.COLLABORATOR,
        status: UserStatus.ACTIVE,
        email: 'colaborador@inexci.com',
        password: hashedPassword,
        name: 'Ana Paula Oliveira',
        phone: generatePhone(),
        cpf: generateCPF(),
        gender: 'F',
        birth_date: new Date('1990-03-10'),
      }),
    );
    console.log('  ➕ Criado: colaborador@inexci.com');
  } else {
    console.log('  ✓ Existe: colaborador@inexci.com');
  }

  // Colaborador 2 - Editor
  let collaborator2 = await userRepo.findOne({
    where: { email: 'assistente@inexci.com' },
  });
  if (!collaborator2) {
    collaborator2 = await userRepo.save(
      userRepo.create({
        role: UserRole.COLLABORATOR,
        status: UserStatus.ACTIVE,
        email: 'assistente@inexci.com',
        password: hashedPassword,
        name: 'João Pedro Lima',
        phone: generatePhone(),
        cpf: generateCPF(),
        gender: 'M',
        birth_date: new Date('1995-07-25'),
      }),
    );
    console.log('  ➕ Criado: assistente@inexci.com');
  } else {
    console.log('  ✓ Existe: assistente@inexci.com');
  }

  console.log('  ✅ 2 colaboradores criados\n');

  // Vincular colaboradores ao médico
  console.log('🔗 Vinculando colaboradores ao médico...');

  let teamMember1 = await teamMemberRepo.findOne({
    where: { doctor_id: doctorUser.id, collaborator_id: collaborator1.id },
  });
  if (!teamMember1) {
    teamMember1 = await teamMemberRepo.save(
      teamMemberRepo.create({
        doctor_id: doctorUser.id, // Corrigido: deve ser user.id, não doctorProfile.id
        collaborator_id: collaborator1.id,
        role: TeamMemberRole.MANAGER,
        status: TeamMemberStatus.ACTIVE,
        can_create_requests: true,
        can_edit_requests: true,
        can_delete_requests: true,
        can_manage_documents: true,
        can_manage_patients: true,
        can_manage_billing: true,
        can_manage_team: true,
        can_view_reports: true,
        accepted_at: new Date(),
      }),
    );
    console.log('  ➕ Vinculado: Ana Paula como GESTOR');
  }

  let teamMember2 = await teamMemberRepo.findOne({
    where: { doctor_id: doctorUser.id, collaborator_id: collaborator2.id },
  });
  if (!teamMember2) {
    teamMember2 = await teamMemberRepo.save(
      teamMemberRepo.create({
        doctor_id: doctorUser.id, // Corrigido: deve ser user.id, não doctorProfile.id
        collaborator_id: collaborator2.id,
        role: TeamMemberRole.EDITOR,
        status: TeamMemberStatus.ACTIVE,
        can_create_requests: true,
        can_edit_requests: true,
        can_delete_requests: false,
        can_manage_documents: true,
        can_manage_patients: true,
        can_manage_billing: false,
        can_manage_team: false,
        can_view_reports: true,
        accepted_at: new Date(),
      }),
    );
    console.log('  ➕ Vinculado: João Pedro como EDITOR');
  }

  console.log('  ✅ Colaboradores vinculados\n');

  // ========================================
  // 3. ENTIDADES DE NEGÓCIO (vinculadas ao médico)
  // ========================================

  console.log('🏥 Criando hospitais...');
  const hospitalData = [
    { name: 'Hospital São Lucas', city: 'São Paulo', state: 'SP' },
    { name: 'Hospital Santa Maria', city: 'Rio de Janeiro', state: 'RJ' },
    { name: 'Hospital Albert Einstein', city: 'São Paulo', state: 'SP' },
    { name: 'Hospital Sírio-Libanês', city: 'São Paulo', state: 'SP' },
    { name: 'Hospital das Clínicas', city: 'Belo Horizonte', state: 'MG' },
  ];

  const hospitals: Hospital[] = [];
  for (const data of hospitalData) {
    let hospital = await hospitalRepo.findOne({ where: { name: data.name } });
    if (!hospital) {
      hospital = await hospitalRepo.save(
        hospitalRepo.create({
          name: data.name,
          cnpj: generateCNPJ(),
          email: faker.internet.email({ provider: 'hospital.com.br' }),
          phone: generatePhone(),
          city: data.city,
          state: data.state,
          active: true,
          doctor_id: doctorUser.id,
        }),
      );
    }
    hospitals.push(hospital);
  }
  console.log(`✅ ${hospitals.length} hospitais\n`);

  console.log('💳 Criando planos de saúde...');
  const healthPlanData = [
    { name: 'Unimed', ans_code: '304701' },
    { name: 'Bradesco Saúde', ans_code: '005711' },
    { name: 'SulAmérica', ans_code: '006246' },
    { name: 'Amil', ans_code: '326305' },
    { name: 'Porto Seguro Saúde', ans_code: '416428' },
    { name: 'NotreDame Intermédica', ans_code: '359017' },
  ];

  const healthPlans: HealthPlan[] = [];
  for (const data of healthPlanData) {
    let plan = await healthPlanRepo.findOne({ where: { name: data.name } });
    if (!plan) {
      plan = await healthPlanRepo.save(
        healthPlanRepo.create({
          name: data.name,
          ans_code: data.ans_code,
          cnpj: generateCNPJ(),
          email: faker.internet.email({ provider: 'planodesaude.com.br' }),
          phone: generatePhone(),
          website: `https://www.${data.name.toLowerCase().replace(/ /g, '')}.com.br`,
          active: true,
          doctor_id: doctorUser.id,
        }),
      );
    }
    healthPlans.push(plan);
  }
  console.log(`✅ ${healthPlans.length} planos de saúde\n`);

  console.log('🏭 Criando fornecedores de OPME...');
  const supplierData = [
    'Johnson & Johnson Medical',
    'Medtronic do Brasil',
    'Stryker Brasil',
    'Zimmer Biomet',
    'Smith & Nephew',
  ];

  const suppliers: Supplier[] = [];
  for (const name of supplierData) {
    let supplier = await supplierRepo.findOne({ where: { name } });
    if (!supplier) {
      supplier = await supplierRepo.save(
        supplierRepo.create({
          name,
          cnpj: generateCNPJ(),
          email: faker.internet.email({ provider: 'opme.com.br' }),
          phone: generatePhone(),
          contact_name: faker.person.fullName(),
          contact_phone: generatePhone(),
          active: true,
          doctor_id: doctorUser.id,
        }),
      );
    }
    suppliers.push(supplier);
  }
  console.log(`✅ ${suppliers.length} fornecedores\n`);

  // Admin (para futuro uso)
  let adminUser = await userRepo.findOne({
    where: { email: 'admin@inexci.com' },
  });
  if (!adminUser) {
    adminUser = await userRepo.save(
      userRepo.create({
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        email: 'admin@inexci.com',
        password: hashedPassword,
        name: 'Administrador Sistema',
        phone: generatePhone(),
      }),
    );
    console.log('👑 Admin criado: admin@inexci.com\n');
  }

  // ========================================
  // 4. PACIENTES (do médico principal)
  // ========================================

  console.log('👥 Criando pacientes...');
  const patients: Patient[] = [];

  const patientNames = [
    { name: 'Roberto Ferreira', gender: 'M' },
    { name: 'Mariana Costa', gender: 'F' },
    { name: 'José Almeida', gender: 'M' },
    { name: 'Fernanda Souza', gender: 'F' },
    { name: 'Paulo Ribeiro', gender: 'M' },
    { name: 'Juliana Martins', gender: 'F' },
    { name: 'Antônio Pereira', gender: 'M' },
    { name: 'Camila Rodrigues', gender: 'F' },
    { name: 'Marcos Oliveira', gender: 'M' },
    { name: 'Beatriz Santos', gender: 'F' },
  ];

  for (const data of patientNames) {
    let patient = await patientRepo.findOne({
      where: { doctor_id: doctorProfile.id, name: data.name },
    });
    if (!patient) {
      const healthPlan = faker.helpers.arrayElement(healthPlans);
      patient = await patientRepo.save(
        patientRepo.create({
          doctor_id: doctorProfile.id,
          name: data.name,
          email: faker.internet.email({ firstName: data.name.split(' ')[0] }),
          phone: generatePhone(),
          cpf: generateCPF(),
          gender: data.gender,
          birth_date: faker.date.birthdate({ min: 25, max: 75, mode: 'age' }),
          health_plan_id: healthPlan.id,
          health_plan_number: faker.string.numeric(12),
          health_plan_type: faker.helpers.arrayElement([
            'Apartamento',
            'Enfermaria',
            'VIP',
          ]),
          city: faker.helpers.arrayElement([
            'São Paulo',
            'Rio de Janeiro',
            'Belo Horizonte',
          ]),
          state: faker.helpers.arrayElement(['SP', 'RJ', 'MG']),
          active: true,
        }),
      );
    }
    patients.push(patient);
  }
  console.log(`✅ ${patients.length} pacientes criados\n`);

  // ========================================
  // 5. SOLICITAÇÕES CIRÚRGICAS
  // ========================================

  console.log('📝 Criando solicitações cirúrgicas...');
  const surgeryRequests: SurgeryRequest[] = [];
  const statuses = [
    SurgeryRequestStatus.PENDING,
    SurgeryRequestStatus.SENT,
    SurgeryRequestStatus.IN_ANALYSIS,
    SurgeryRequestStatus.IN_SCHEDULING,
    SurgeryRequestStatus.SCHEDULED,
    SurgeryRequestStatus.PERFORMED,
    SurgeryRequestStatus.INVOICED,
    SurgeryRequestStatus.FINALIZED,
    SurgeryRequestStatus.CLOSED,
  ];

  for (let i = 0; i < 15; i++) {
    const patient = patients[i % patients.length];
    const status = statuses[i % statuses.length];
    const hospital = faker.helpers.arrayElement(hospitals);
    const cid = faker.helpers.arrayElement(cids);
    const healthPlan =
      healthPlans.find((hp) => hp.id === patient.health_plan_id) ||
      healthPlans[0];

    const request = surgeryRequestRepo.create({
      doctor_id: doctorProfile.id,
      created_by_id: faker.helpers.arrayElement([
        doctorUser.id,
        collaborator1.id,
        collaborator2.id,
      ]),
      manager_id: faker.helpers.arrayElement([
        collaborator1.id,
        collaborator2.id,
      ]),
      patient_id: patient.id,
      hospital_id: hospital.id,
      health_plan_id: healthPlan.id,
      cid_id: cid.id,
      status,
      priority: faker.helpers.arrayElement([
        SurgeryRequestPriority.LOW,
        SurgeryRequestPriority.MEDIUM,
        SurgeryRequestPriority.HIGH,
        SurgeryRequestPriority.URGENT,
      ]),
      is_indication: faker.datatype.boolean({ probability: 0.2 }),
      diagnosis: `Paciente apresenta ${cid.description.toLowerCase()} com indicação cirúrgica.`,
      medical_report: faker.lorem.paragraphs(2),
      patient_history: faker.lorem.paragraph(),
      surgery_description: `Procedimento cirúrgico para tratamento de ${cid.description.toLowerCase()}.`,
      health_plan_registration: patient.health_plan_number,
      health_plan_type: patient.health_plan_type,
    });

    // Definir datas baseadas no status
    if (status >= SurgeryRequestStatus.SCHEDULED) {
      request.surgery_date = faker.date.future({ years: 0.5 });
    }
    if (status >= SurgeryRequestStatus.PERFORMED) {
      request.surgery_date = faker.date.recent({ days: 30 });
      request.surgery_performed_at = faker.date.recent({ days: 30 });
    }

    const savedRequest = await surgeryRequestRepo.save(request);
    surgeryRequests.push(savedRequest);

    // Adicionar procedimentos
    const numProcedures = faker.number.int({ min: 1, max: 3 });
    const selectedProcedures = faker.helpers.arrayElements(
      procedures,
      numProcedures,
    );
    for (const proc of selectedProcedures) {
      const srp = await surgeryRequestProcedureRepo.save(
        surgeryRequestProcedureRepo.create({
          surgery_request_id: savedRequest.id,
          procedure_id: proc.id,
          quantity: faker.number.int({ min: 1, max: 2 }),
          authorized_quantity:
            status >= SurgeryRequestStatus.IN_SCHEDULING
              ? faker.number.int({ min: 1, max: 2 })
              : null,
        }),
      );
    }

    // Adicionar itens de OPME se for ortopédica
    if (cid.id.startsWith('M')) {
      const numOpme = faker.number.int({ min: 1, max: 4 });
      for (let j = 0; j < numOpme; j++) {
        const opme = await opmeItemRepo.save(
          opmeItemRepo.create({
            surgery_request_id: savedRequest.id,
            name: faker.helpers.arrayElement([
              'Prótese de Joelho',
              'Placa de Titânio',
              'Parafuso Ósseo',
              'Âncora de Sutura',
            ]),
            brand: faker.helpers.arrayElement([
              'Zimmer',
              'DePuy',
              'Stryker',
              'Smith & Nephew',
            ]),
            distributor: faker.helpers.arrayElement(suppliers).name,
            quantity: faker.number.int({ min: 1, max: 4 }),
            authorized_quantity:
              status >= SurgeryRequestStatus.IN_SCHEDULING
                ? faker.number.int({ min: 1, max: 4 })
                : null,
          }),
        );
      }
    }

    // Adicionar cotações
    if (status >= SurgeryRequestStatus.SENT) {
      const numQuotations = faker.number.int({ min: 1, max: 3 });
      const selectedSuppliers = faker.helpers.arrayElements(
        suppliers,
        numQuotations,
      );
      for (let k = 0; k < selectedSuppliers.length; k++) {
        const quotation = await quotationRepo.save(
          quotationRepo.create({
            surgery_request_id: savedRequest.id,
            supplier_id: selectedSuppliers[k].id,
            proposal_number: `PROP-${faker.string.alphanumeric(6).toUpperCase()}`,
            total_value: parseFloat(
              faker.commerce.price({ min: 5000, max: 30000 }),
            ),
            submission_date: faker.date.recent({ days: 30 }),
            valid_until: faker.date.future({ years: 0.25 }),
            selected: k === 0 && status >= SurgeryRequestStatus.IN_SCHEDULING,
          }),
        );
      }
    }

    // Adicionar documentos
    const docTypes = [
      { key: 'laudoMedico', name: 'Laudo Médico' },
      { key: 'exameLaboratorial', name: 'Exames Laboratoriais' },
      { key: 'imagemDiagnostica', name: 'Imagem Diagnóstica' },
      { key: 'termoConsentimento', name: 'Termo de Consentimento' },
    ];
    const numDocs = faker.number.int({ min: 1, max: docTypes.length });
    const selectedDocs = faker.helpers.arrayElements(docTypes, numDocs);
    for (const docType of selectedDocs) {
      const doc = await documentRepo.save(
        documentRepo.create({
          surgery_request_id: savedRequest.id,
          created_by: faker.helpers.arrayElement([
            doctorUser.id,
            collaborator1.id,
          ]),
          key: docType.key,
          name: docType.name,
          uri: `https://storage.inexci.com/docs/${savedRequest.id}/${faker.string.uuid()}.pdf`,
        }),
      );
    }

    // Adicionar histórico de status
    if (status > SurgeryRequestStatus.PENDING) {
      for (let s = 1; s < status; s++) {
        const statusUpdate = await statusUpdateRepo.save(
          statusUpdateRepo.create({
            surgery_request_id: savedRequest.id,
            prev_status: s,
            new_status: s + 1,
          }),
        );
      }
    }
  }

  console.log(`✅ ${surgeryRequests.length} solicitações cirúrgicas criadas\n`);

  // ========================================
  // 6. NOTIFICAÇÕES
  // ========================================

  console.log('🔔 Criando notificações...');

  const notificationData = [
    {
      user_id: doctorUser.id,
      type: NotificationType.NEW_SURGERY_REQUEST,
      title: 'Nova solicitação criada',
      message:
        'Ana Paula criou uma nova solicitação cirúrgica para Roberto Ferreira.',
      link: '/solicitacoes/1',
    },
    {
      user_id: doctorUser.id,
      type: NotificationType.STATUS_UPDATE,
      title: 'Status atualizado',
      message: 'A solicitação INX-2400001 foi autorizada pelo convênio.',
      link: '/solicitacoes/1',
    },
    {
      user_id: collaborator1.id,
      type: NotificationType.INFO,
      title: 'Bem-vindo à equipe!',
      message: 'Você foi adicionado como colaborador do Dr. Carlos Silva.',
    },
  ];

  for (const data of notificationData) {
    const notification = await notificationRepo.save(
      notificationRepo.create(data),
    );
  }
  console.log(`✅ ${notificationData.length} notificações criadas\n`);

  // ========================================
  // 7. CONFIGURAÇÕES DE NOTIFICAÇÃO
  // ========================================

  console.log('⚙️ Criando configurações de notificação...');

  for (const user of [doctorUser, collaborator1, collaborator2]) {
    let settings = await notificationSettingsRepo.findOne({
      where: { user_id: user.id },
    });
    if (!settings) {
      settings = await notificationSettingsRepo.save(
        notificationSettingsRepo.create({
          user_id: user.id,
          email_notifications: true,
          sms_notifications: false,
          push_notifications: true,
          new_surgery_request: true,
          status_update: true,
          pendencies: true,
          expiring_documents: true,
          weekly_report: false,
        }),
      );
    }
  }
  console.log(`✅ Configurações de notificação criadas\n`);

  // ========================================
  // FINALIZAÇÃO
  // ========================================

  console.log('🎉 Seed concluído com sucesso!\n');
  console.log('📊 Resumo:');
  console.log('  - Usuários: 5 (1 admin, 2 médicos, 2 colaboradores)');
  console.log('  - Hospitais: 5');
  console.log('  - Planos de Saúde: 6');
  console.log('  - Fornecedores: 5');
  console.log('  - Pacientes: 10');
  console.log('  - Solicitações: 15');
  console.log('');
  console.log('🔐 Credenciais de teste:');
  console.log('  - Admin: admin@inexci.com / 123456');
  console.log('  - Médico: medico@inexci.com / 123456');
  console.log('  - Médico 2: medico2@inexci.com / 123456');
  console.log('  - Colaborador (Gestor): colaborador@inexci.com / 123456');
  console.log('  - Colaborador (Editor): assistente@inexci.com / 123456');

  await dataSource.destroy();
  process.exit(0);
}

main().catch((error) => {
  console.error('❌ Erro durante o seed:', error);
  process.exit(1);
});
