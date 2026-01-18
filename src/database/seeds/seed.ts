import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { faker } from '@faker-js/faker';
import { SeedDataSource } from '../typeorm/seed-data-source';

// Importar todas as entidades
import { User } from '../entities/user.entity';
import { Clinic } from '../entities/clinic.entity';
import { Cid } from '../entities/cid.entity';
import { Procedure } from '../entities/procedure.entity';
import { SurgeryRequest } from '../entities/surgery-request.entity';
import { SurgeryRequestProcedure } from '../entities/surgery-request-procedure.entity';
import { OpmeItem } from '../entities/opme-item.entity';
import { Document } from '../entities/document.entity';
import { Pendency } from '../entities/pendency.entity';
import { SurgeryRequestQuotation } from '../entities/surgery-request-quotation.entity';
import { StatusUpdate } from '../entities/status-update.entity';
import { Chat } from '../entities/chat.entity';
import { ChatMessage } from '../entities/chat-message.entity';
import { RecoveryCode } from '../entities/recovery-code.entity';
import { DefaultDocumentClinic } from '../entities/default-document-clinic.entity';

/**
 * 🌱 SEED IDEMPOTENTE
 *
 * Este seed pode ser executado múltiplas vezes sem criar dados duplicados.
 *
 * Comportamento:
 * - Clínicas, CIDs e Procedimentos: Verifica se já existem antes de criar
 * - Usuários de teste fixos: Verifica por email antes de criar
 * - Usuários adicionais: Cria apenas se a quantidade for inferior ao esperado
 * - Solicitações, documentos, etc: Cria apenas se não houver dados suficientes
 *
 * Cenários cobertos:
 * - Todos os status de solicitação (1-9)
 * - Solicitações com e sem hospital
 * - Solicitações com e sem plano de saúde
 * - Solicitações indicadas e não indicadas
 * - Múltiplos procedimentos por solicitação
 * - Documentos, pendências, cotações e chats variados
 * - Códigos de recuperação usados e não usados
 */

// Verificação de ambiente - apenas local ou dev
function checkEnvironment() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const allowedEnvs = ['development', 'local', 'dev'];

  if (!allowedEnvs.includes(nodeEnv.toLowerCase())) {
    console.error(
      '❌ ERRO: Seed só pode ser executado em ambiente local ou de desenvolvimento!',
    );
    console.error(`   Ambiente atual: ${nodeEnv}`);
    console.error(
      '   Para executar o seed, defina NODE_ENV=development ou NODE_ENV=local',
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

  // Calcula primeiro dígito verificador
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cpf[i]) * (10 - i);
  }
  let digit = 11 - (sum % 11);
  cpf += digit >= 10 ? 0 : digit;

  // Calcula segundo dígito verificador
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

  // Calcula primeiro dígito verificador
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(cnpj[i]) * weights1[i];
  }
  let digit = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  cnpj += digit;

  // Calcula segundo dígito verificador
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += parseInt(cnpj[i]) * weights2[i];
  }
  digit = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  cnpj += digit;

  return cnpj;
}

// Função auxiliar para gerar telefone brasileiro
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

  console.log('🌱 Iniciando seed do banco de dados...');
  console.log('⏳ Este processo pode levar alguns minutos...\n');

  // Inicializar conexão
  const dataSource = await SeedDataSource.initialize();

  // Hash da senha padrão para todos os usuários
  const hashedPassword = await bcrypt.hash('123456', 10);

  // Repositories
  const clinicRepo = dataSource.getRepository(Clinic);
  const cidRepo = dataSource.getRepository(Cid);
  const procedureRepo = dataSource.getRepository(Procedure);
  const userRepo = dataSource.getRepository(User);
  const defaultDocRepo = dataSource.getRepository(DefaultDocumentClinic);
  const surgeryRequestRepo = dataSource.getRepository(SurgeryRequest);
  const surgeryRequestProcedureRepo = dataSource.getRepository(
    SurgeryRequestProcedure,
  );
  const opmeItemRepo = dataSource.getRepository(OpmeItem);
  const documentRepo = dataSource.getRepository(Document);
  const pendencyRepo = dataSource.getRepository(Pendency);
  const quotationRepo = dataSource.getRepository(SurgeryRequestQuotation);
  const statusUpdateRepo = dataSource.getRepository(StatusUpdate);
  const chatRepo = dataSource.getRepository(Chat);
  const chatMessageRepo = dataSource.getRepository(ChatMessage);
  const recoveryCodeRepo = dataSource.getRepository(RecoveryCode);

  // ========== CLÍNICAS ==========
  console.log('🏥 Verificando clínicas...');
  const clinics: Clinic[] = [];
  const clinicNames = [
    'Clínica Vida & Saúde',
    'Centro Médico Excellence',
    'Clínica Bem Estar',
    'Instituto de Cirurgia Avançada',
    'Clínica São Rafael',
  ];

  for (const name of clinicNames) {
    let clinic = await clinicRepo.findOne({ where: { name } });
    if (!clinic) {
      clinic = clinicRepo.create({ name });
      await clinicRepo.save(clinic);
      console.log(`  ➕ Criada: ${name}`);
    } else {
      console.log(`  ✓ Existe: ${name}`);
    }
    clinics.push(clinic);
  }
  console.log(`✅ ${clinics.length} clínicas no total\n`);

  // ========== CIDs ==========
  console.log('🏥 Verificando CIDs...');
  const cidData = [
    { id: 'K80.2', description: 'Cálculo vesícula biliar' },
    { id: 'K40.9', description: 'Hérnia inguinal' },
    { id: 'K35.8', description: 'Apendicite aguda' },
    { id: 'M17.1', description: 'Gonartrose primária' },
    { id: 'M23.2', description: 'Lesão de menisco' },
    { id: 'M51.1', description: 'Hérnia de disco lombar' },
    { id: 'M16.1', description: 'Coxartrose primária' },
    { id: 'K42.9', description: 'Hérnia umbilical' },
    { id: 'M75.1', description: 'Síndrome manguito rotador' },
    { id: 'K43.9', description: 'Hérnia ventral' },
  ];

  const cids: Cid[] = [];
  let cidCreated = 0;
  for (const cid of cidData) {
    let existingCid = await cidRepo.findOne({ where: { id: cid.id } });
    if (!existingCid) {
      existingCid = cidRepo.create(cid);
      await cidRepo.save(existingCid);
      cidCreated++;
      console.log(`  ➕ Criado: ${cid.id}`);
    } else {
      console.log(`  ✓ Existe: ${cid.id}`);
    }
    cids.push(existingCid);
  }
  console.log(`✅ ${cids.length} CIDs no total (${cidCreated} novos)\n`);

  // ========== PROCEDIMENTOS ==========
  console.log('💉 Verificando procedimentos...');
  const procedureData = [
    { tuss_code: '30701018', name: 'Colecistectomia videolaparoscópica' },
    { tuss_code: '30715016', name: 'Herniorrafia inguinal (unilateral)' },
    { tuss_code: '30717043', name: 'Apendicectomia' },
    { tuss_code: '40801098', name: 'Artroplastia total de joelho' },
    { tuss_code: '40808041', name: 'Artroscopia de joelho' },
    { tuss_code: '30725046', name: 'Colectomia parcial (hemicolectomia)' },
    { tuss_code: '40801071', name: 'Artroplastia total de quadril' },
    { tuss_code: '30715032', name: 'Herniorrafia umbilical' },
    { tuss_code: '30911016', name: 'Discectomia lombar' },
    { tuss_code: '40808033', name: 'Artroscopia de ombro' },
    { tuss_code: '30715024', name: 'Herniorrafia incisional' },
    { tuss_code: '40801020', name: 'Osteossíntese de fêmur' },
    { tuss_code: '30717035', name: 'Gastrectomia parcial' },
    { tuss_code: '40808025', name: 'Meniscectomia' },
    { tuss_code: '30701026', name: 'Colecistectomia por laparotomia' },
  ];

  const procedures: Procedure[] = [];
  let procedureCreated = 0;
  for (const proc of procedureData) {
    let procedure = await procedureRepo.findOne({
      where: { tuss_code: proc.tuss_code },
    });
    if (!procedure) {
      procedure = procedureRepo.create({
        active: true,
        tuss_code: proc.tuss_code,
        name: proc.name,
      });
      await procedureRepo.save(procedure);
      procedureCreated++;
      console.log(`  ➕ Criado: ${proc.name}`);
    } else {
      console.log(`  ✓ Existe: ${proc.name}`);
    }
    procedures.push(procedure);
  }
  console.log(
    `✅ ${procedures.length} procedimentos no total (${procedureCreated} novos)\n`,
  );

  // ========== USUÁRIOS DE TESTE (FIXOS) ==========
  console.log('👥 Verificando usuários de teste...');

  const mainClinic = clinics[0]; // Usar a primeira clínica como principal

  // 1. MÉDICO DE TESTE
  let testDoctor = await userRepo.findOne({
    where: { email: 'medico@inexci.com' },
  });
  if (!testDoctor) {
    testDoctor = userRepo.create({
      clinic_id: mainClinic.id,
      status: 2, // Ativo
      pv: 1, // Médico
      email: 'medico@inexci.com',
      password: hashedPassword,
      name: 'Dr. Carlos Silva',
      phone: '11987654321',
      gender: 'M',
      birth_date: new Date('1975-05-15'),
      document: '12345678901',
    });
    await userRepo.save(testDoctor);
    console.log('  ➕ Médico de teste criado: medico@inexci.com');
  } else {
    console.log('  ✓ Médico de teste já existe: medico@inexci.com');
  }

  // 2. COLABORADOR DE TESTE
  let testCollaborator = await userRepo.findOne({
    where: { email: 'colaborador@inexci.com' },
  });
  if (!testCollaborator) {
    testCollaborator = userRepo.create({
      clinic_id: mainClinic.id,
      status: 2, // Ativo
      pv: 2, // Colaborador
      email: 'colaborador@inexci.com',
      password: hashedPassword,
      name: 'Maria Santos',
      phone: '11987654322',
      gender: 'F',
      birth_date: new Date('1985-08-20'),
      document: '12345678902',
    });
    await userRepo.save(testCollaborator);
    console.log('  ➕ Colaborador de teste criado: colaborador@inexci.com');
  } else {
    console.log('  ✓ Colaborador de teste já existe: colaborador@inexci.com');
  }

  // 3. HOSPITAL DE TESTE
  let testHospital = await userRepo.findOne({
    where: { email: 'hospital@inexci.com' },
  });
  if (!testHospital) {
    testHospital = userRepo.create({
      clinic_id: mainClinic.id,
      status: 2, // Ativo
      pv: 3, // Hospital
      email: 'hospital@inexci.com',
      password: hashedPassword,
      name: 'Hospital São Lucas',
      phone: '11987654323',
      document: '12345678000190',
      company: 'Hospital São Lucas LTDA',
    });
    await userRepo.save(testHospital);
    console.log('  ➕ Hospital de teste criado: hospital@inexci.com');
  } else {
    console.log('  ✓ Hospital de teste já existe: hospital@inexci.com');
  }

  // 4. PACIENTE DE TESTE
  let testPatient = await userRepo.findOne({
    where: { email: 'paciente@inexci.com' },
  });
  if (!testPatient) {
    testPatient = userRepo.create({
      clinic_id: mainClinic.id,
      status: 2, // Ativo
      pv: 4, // Paciente
      email: 'paciente@inexci.com',
      password: hashedPassword,
      name: 'João Pedro Oliveira',
      phone: '11987654324',
      gender: 'M',
      birth_date: new Date('1990-03-10'),
      document: '12345678903',
    });
    await userRepo.save(testPatient);
    console.log('  ➕ Paciente de teste criado: paciente@inexci.com');
  } else {
    console.log('  ✓ Paciente de teste já existe: paciente@inexci.com');
  }

  // 5. FORNECEDOR DE TESTE
  let testSupplier = await userRepo.findOne({
    where: { email: 'fornecedor@inexci.com' },
  });
  if (!testSupplier) {
    testSupplier = userRepo.create({
      clinic_id: mainClinic.id,
      status: 2, // Ativo
      pv: 5, // Fornecedor
      email: 'fornecedor@inexci.com',
      password: hashedPassword,
      name: 'MedTech Distribuidora',
      phone: '11987654325',
      document: '12345678000191',
      company: 'MedTech Distribuidora LTDA',
    });
    await userRepo.save(testSupplier);
    console.log('  ➕ Fornecedor de teste criado: fornecedor@inexci.com');
  } else {
    console.log('  ✓ Fornecedor de teste já existe: fornecedor@inexci.com');
  }

  // 6. PLANO DE SAÚDE DE TESTE
  let testHealthPlan = await userRepo.findOne({
    where: { email: 'plano@inexci.com' },
  });
  if (!testHealthPlan) {
    testHealthPlan = userRepo.create({
      clinic_id: mainClinic.id,
      status: 2, // Ativo
      pv: 6, // Plano de Saúde
      email: 'plano@inexci.com',
      password: hashedPassword,
      name: 'Unimed Teste',
      phone: '11987654326',
      document: '12345678000192',
      company: 'Unimed Cooperativa de Saúde',
    });
    await userRepo.save(testHealthPlan);
    console.log('  ➕ Plano de saúde de teste criado: plano@inexci.com');
  } else {
    console.log('  ✓ Plano de saúde de teste já existe: plano@inexci.com');
  }
  console.log('✅ Usuários de teste verificados\n');

  // ========== USUÁRIOS ADICIONAIS ==========
  console.log('👥 Verificando usuários adicionais...');

  // Médicos (15 total, incluindo 1 de teste)
  let doctors: User[] = await userRepo.find({ where: { pv: 1 } });
  const targetDoctors = 15;
  const doctorsToCreate = Math.max(0, targetDoctors - doctors.length);

  console.log(
    `  Médicos existentes: ${doctors.length}, criando: ${doctorsToCreate}`,
  );

  for (let i = 0; i < doctorsToCreate; i++) {
    const firstName = faker.person.firstName('male');
    const lastName = faker.person.lastName();

    const doctor = userRepo.create({
      clinic_id: faker.helpers.arrayElement(clinics).id,
      status: 2, // Ativo
      pv: 1, // Médico
      email: `dr.${firstName.toLowerCase()}.${lastName.toLowerCase()}${Date.now()}${i}@inexci.com`,
      password: hashedPassword,
      name: `Dr. ${firstName} ${lastName}`,
      phone: generatePhone(),
      gender: faker.helpers.arrayElement(['M', 'F']),
      birth_date: faker.date.birthdate({ min: 35, max: 65, mode: 'age' }),
      document: generateCPF(),
    });
    await userRepo.save(doctor);
    doctors.push(doctor);
  }
  console.log(`✅ ${doctors.length} médicos no total\n`);

  // Colaboradores (20 total, incluindo 1 de teste)
  let collaborators: User[] = await userRepo.find({ where: { pv: 2 } });
  const targetCollaborators = 20;
  const collaboratorsToCreate = Math.max(
    0,
    targetCollaborators - collaborators.length,
  );

  console.log(
    `  Colaboradores existentes: ${collaborators.length}, criando: ${collaboratorsToCreate}`,
  );

  for (let i = 0; i < collaboratorsToCreate; i++) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();

    const collaborator = userRepo.create({
      clinic_id: faker.helpers.arrayElement(clinics).id,
      status: 2, // Ativo
      pv: 2, // Colaborador
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${Date.now()}${i}@inexci.com`,
      password: hashedPassword,
      name: `${firstName} ${lastName}`,
      phone: generatePhone(),
      gender: faker.helpers.arrayElement(['M', 'F']),
      birth_date: faker.date.birthdate({ min: 22, max: 55, mode: 'age' }),
      document: generateCPF(),
    });
    await userRepo.save(collaborator);
    collaborators.push(collaborator);
  }
  console.log(`✅ ${collaborators.length} colaboradores no total\n`);

  // Hospitais (10 total, incluindo 1 de teste)
  let hospitals: User[] = await userRepo.find({ where: { pv: 3 } });
  const targetHospitals = 10;
  const hospitalsToCreate = Math.max(0, targetHospitals - hospitals.length);

  console.log(
    `  Hospitais existentes: ${hospitals.length}, criando: ${hospitalsToCreate}`,
  );

  const hospitalTypes = [
    'Hospital',
    'Clínica Cirúrgica',
    'Centro Médico',
    'Instituto',
  ];

  for (let i = 0; i < hospitalsToCreate; i++) {
    const type = faker.helpers.arrayElement(hospitalTypes);
    const name = `${type} ${faker.location.city()}`;

    const hospital = userRepo.create({
      clinic_id: faker.helpers.arrayElement(clinics).id,
      status: 2, // Ativo
      pv: 3, // Hospital
      email: `contato@${name.toLowerCase().replace(/\s/g, '')}${Date.now()}${i}.com.br`,
      password: hashedPassword,
      name: name,
      phone: generatePhone(),
      document: generateCNPJ(),
      company: `${name} LTDA`,
    });
    await userRepo.save(hospital);
    hospitals.push(hospital);
  }
  console.log(`✅ ${hospitals.length} hospitais no total\n`);

  // Pacientes (50 total, incluindo 1 de teste)
  let patients: User[] = await userRepo.find({ where: { pv: 4 } });
  const targetPatients = 50;
  const patientsToCreate = Math.max(0, targetPatients - patients.length);

  console.log(
    `  Pacientes existentes: ${patients.length}, criando: ${patientsToCreate}`,
  );

  for (let i = 0; i < patientsToCreate; i++) {
    const gender = faker.helpers.arrayElement(['M', 'F']);
    const firstName = faker.person.firstName(
      gender === 'M' ? 'male' : 'female',
    );
    const lastName = faker.person.lastName();

    const patient = userRepo.create({
      clinic_id: faker.helpers.arrayElement(clinics).id,
      status: 2, // Ativo
      pv: 4, // Paciente
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${Date.now()}${i}@email.com`,
      password: hashedPassword,
      name: `${firstName} ${lastName}`,
      phone: generatePhone(),
      gender: gender,
      birth_date: faker.date.birthdate({ min: 18, max: 85, mode: 'age' }),
      document: generateCPF(),
    });
    await userRepo.save(patient);
    patients.push(patient);
  }
  console.log(`✅ ${patients.length} pacientes no total\n`);

  // Fornecedores (12 total, incluindo 1 de teste)
  let suppliers: User[] = await userRepo.find({ where: { pv: 5 } });
  const targetSuppliers = 12;
  const suppliersToCreate = Math.max(0, targetSuppliers - suppliers.length);

  console.log(
    `  Fornecedores existentes: ${suppliers.length}, criando: ${suppliersToCreate}`,
  );

  const supplierTypes = [
    'Distribuidora Médica',
    'Importadora Hospitalar',
    'Fornecedora de OPME',
    'Comercial Médica',
  ];

  for (let i = 0; i < suppliersToCreate; i++) {
    const type = faker.helpers.arrayElement(supplierTypes);
    const name = `${type} ${faker.company.name()}`;

    const supplier = userRepo.create({
      clinic_id: faker.helpers.arrayElement(clinics).id,
      status: 2, // Ativo
      pv: 5, // Fornecedor
      email: `vendas${Date.now()}${i}@${faker.internet.domainWord()}.com.br`,
      password: hashedPassword,
      name: name,
      phone: generatePhone(),
      document: generateCNPJ(),
      company: `${name} LTDA`,
    });
    await userRepo.save(supplier);
    suppliers.push(supplier);
  }
  console.log(`✅ ${suppliers.length} fornecedores no total\n`);

  // Planos de Saúde (8 total, incluindo 1 de teste)
  let healthPlans: User[] = await userRepo.find({ where: { pv: 6 } });

  const planNamesAll = [
    'Amil',
    'SulAmérica',
    'Bradesco Saúde',
    'Porto Seguro Saúde',
    'NotreDame Intermédica',
    'Hapvida',
    'Prevent Senior',
  ];

  const existingPlanNames = new Set(healthPlans.map((hp) => hp.name));
  const planNamesToCreate = planNamesAll.filter(
    (name) => !existingPlanNames.has(name),
  );

  console.log(
    `  Planos existentes: ${healthPlans.length}, criando: ${planNamesToCreate.length}`,
  );

  for (const planName of planNamesToCreate) {
    const healthPlan = userRepo.create({
      clinic_id: faker.helpers.arrayElement(clinics).id,
      status: 2, // Ativo
      pv: 6, // Plano de Saúde
      email: `atendimento@${planName.toLowerCase().replace(/\s/g, '')}${Date.now()}.com.br`,
      password: hashedPassword,
      name: planName,
      phone: generatePhone(),
      document: generateCNPJ(),
      company: `${planName} Cooperativa de Saúde`,
    });
    await userRepo.save(healthPlan);
    healthPlans.push(healthPlan);
  }
  console.log(`✅ ${healthPlans.length} planos de saúde no total\n`);

  // ========== DOCUMENTOS PADRÃO DAS CLÍNICAS ==========
  console.log('📄 Verificando documentos padrão das clínicas...');
  const defaultDocuments = [
    { key: 'medical_report', name: 'Relatório Médico' },
    { key: 'exam_results', name: 'Resultados de Exames' },
    { key: 'consent_term', name: 'Termo de Consentimento' },
    { key: 'prescription', name: 'Prescrição Médica' },
    { key: 'anamnesis', name: 'Anamnese' },
  ];

  let defaultDocCount = 0;
  let defaultDocCreated = 0;
  for (const clinic of clinics) {
    const clinicAdmin =
      collaborators.find((c) => c.clinic_id === clinic.id) || collaborators[0];

    for (const doc of defaultDocuments) {
      const existing = await defaultDocRepo.findOne({
        where: {
          clinic_id: clinic.id,
          key: doc.key,
        },
      });

      if (!existing) {
        const defaultDoc = defaultDocRepo.create({
          clinic_id: clinic.id,
          created_by: clinicAdmin.id,
          key: doc.key,
          name: doc.name,
        });
        await defaultDocRepo.save(defaultDoc);
        defaultDocCreated++;
      }
      defaultDocCount++;
    }
  }
  console.log(
    `✅ ${defaultDocCount} documentos padrão verificados (${defaultDocCreated} novos)\n`,
  );

  // ========== SOLICITAÇÕES DE CIRURGIA ==========
  console.log('🏥 Verificando solicitações de cirurgia...');

  const existingSurgeryRequests = await surgeryRequestRepo.count();
  const targetSurgeryRequests = 80;
  const surgeryRequestsToCreate = Math.max(
    0,
    targetSurgeryRequests - existingSurgeryRequests,
  );

  console.log(
    `  Solicitações existentes: ${existingSurgeryRequests}, criando: ${surgeryRequestsToCreate}`,
  );

  const statuses = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const surgeryRequests: SurgeryRequest[] = [];

  for (let i = 0; i < surgeryRequestsToCreate; i++) {
    const doctor = faker.helpers.arrayElement(doctors);
    const patient = faker.helpers.arrayElement(patients);
    const hospital = faker.helpers.arrayElement(hospitals);
    const collaborator =
      collaborators.find((c) => c.clinic_id === doctor.clinic_id) ||
      collaborators[0];
    const healthPlan = faker.helpers.arrayElement(healthPlans);
    const status = faker.helpers.arrayElement(statuses);
    const cid = faker.helpers.arrayElement(cids);

    const isIndication = faker.datatype.boolean(0.2); // 20% são indicações
    const daysAgo = faker.number.int({ min: 1, max: 90 });
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - daysAgo);

    const surgeryRequest = surgeryRequestRepo.create({
      doctor_id: doctor.id,
      responsible_id: collaborator.id,
      hospital_id: hospital.id,
      patient_id: patient.id,
      health_plan_id: isIndication ? null : healthPlan.id,
      status: status,
      is_indication: isIndication,
      indication_name: isIndication ? faker.company.name() : null,
      health_plan_registration: isIndication ? null : faker.string.numeric(10),
      health_plan_type: isIndication
        ? null
        : faker.helpers.arrayElement(['Enfermaria', 'Apartamento', 'VIP']),
      cid_id: cid.id,
      diagnosis: faker.lorem.paragraph(),
      medical_report: faker.lorem.paragraphs(3),
      patient_history: faker.lorem.paragraphs(2),
      surgery_date: status >= 7 ? faker.date.future({ years: 0.5 }) : null,
      invoiced_value:
        status === 8
          ? faker.number.float({ min: 5000, max: 50000, fractionDigits: 2 })
          : null,
      received_value:
        status === 8 && faker.datatype.boolean(0.7)
          ? faker.number.float({ min: 5000, max: 50000, fractionDigits: 2 })
          : null,
      invoiced_date: status === 8 ? faker.date.recent({ days: 30 }) : null,
      received_date:
        status === 8 && faker.datatype.boolean(0.7)
          ? faker.date.recent({ days: 20 })
          : null,
      protocol: `SR-2026-${String(i + 1).padStart(5, '0')}`,
      contest_reason: status === 10 ? faker.lorem.sentence() : null,
      date_call: status >= 5 ? faker.date.recent({ days: 15 }) : null,
      date_options:
        status >= 6
          ? JSON.stringify([
              faker.date.future({ years: 0.2 }).toISOString(),
              faker.date.future({ years: 0.3 }).toISOString(),
              faker.date.future({ years: 0.4 }).toISOString(),
            ])
          : null,
      created_at: createdAt,
    });
    await surgeryRequestRepo.save(surgeryRequest);
    surgeryRequests.push(surgeryRequest);
  }
  console.log(
    `✅ ${surgeryRequests.length} solicitações de cirurgia criadas\n`,
  );

  // ========== PROCEDIMENTOS DAS SOLICITAÇÕES ==========
  console.log('💊 Vinculando procedimentos às solicitações...');
  let procedureCount = 0;

  for (const request of surgeryRequests) {
    const numProcedures = faker.number.int({ min: 1, max: 3 });
    const selectedProcedures = faker.helpers.arrayElements(
      procedures,
      numProcedures,
    );

    for (const procedure of selectedProcedures) {
      const quantity = faker.number.int({ min: 1, max: 2 });
      const srp = surgeryRequestProcedureRepo.create({
        surgery_request_id: request.id,
        procedure_id: procedure.id,
        quantity: quantity,
        authorized_quantity: request.status >= 6 ? quantity : null,
      });
      await surgeryRequestProcedureRepo.save(srp);
      procedureCount++;
    }
  }
  console.log(`✅ ${procedureCount} procedimentos vinculados\n`);

  // ========== ITENS OPME ==========
  console.log('🔧 Criando itens OPME...');
  const opmeItems = [
    {
      name: 'Prótese de Joelho',
      brand: 'DePuy Synthes',
      distributor: 'Johnson & Johnson',
    },
    {
      name: 'Parafuso Pedicular',
      brand: 'Medtronic',
      distributor: 'Medtronic Brasil',
    },
    {
      name: 'Placa de Fixação',
      brand: 'Stryker',
      distributor: 'Stryker do Brasil',
    },
    {
      name: 'Prótese de Quadril',
      brand: 'Zimmer Biomet',
      distributor: 'Zimmer Biomet Brasil',
    },
    {
      name: 'Âncora de Sutura',
      brand: 'Arthrex',
      distributor: 'Arthrex Brasil',
    },
    {
      name: 'Tela Cirúrgica',
      brand: 'Ethicon',
      distributor: 'Johnson & Johnson',
    },
    {
      name: 'Clipe de Titânio',
      brand: 'B. Braun',
      distributor: 'B. Braun Medical',
    },
    { name: 'Enxerto Ósseo', brand: 'Baumer', distributor: 'Baumer S.A.' },
  ];

  let opmeCount = 0;
  for (const request of surgeryRequests) {
    if (request.status >= 2 && faker.datatype.boolean(0.7)) {
      // 70% têm OPME
      const numItems = faker.number.int({ min: 1, max: 4 });
      const selectedItems = faker.helpers.arrayElements(opmeItems, numItems);

      for (const item of selectedItems) {
        const quantity = faker.number.int({ min: 1, max: 5 });
        const opmeItem = opmeItemRepo.create({
          surgery_request_id: request.id,
          name: item.name,
          brand: item.brand,
          distributor: item.distributor,
          quantity: quantity,
          authorized_quantity: request.status >= 6 ? quantity : null,
        });
        await opmeItemRepo.save(opmeItem);
        opmeCount++;
      }
    }
  }
  console.log(`✅ ${opmeCount} itens OPME criados\n`);

  // ========== DOCUMENTOS ==========
  console.log('📋 Criando documentos das solicitações...');
  const documentTypes = [
    { key: 'medical_report', name: 'Relatório Médico' },
    { key: 'exam_results', name: 'Resultados de Exames' },
    { key: 'consent_term', name: 'Termo de Consentimento' },
    { key: 'prescription', name: 'Prescrição Médica' },
    { key: 'authorization', name: 'Autorização do Plano' },
    { key: 'lab_results', name: 'Exames Laboratoriais' },
    { key: 'imaging', name: 'Exames de Imagem' },
  ];

  let documentCount = 0;
  for (const request of surgeryRequests) {
    if (request.status >= 2) {
      const numDocs = faker.number.int({ min: 2, max: 5 });
      const selectedDocs = faker.helpers.arrayElements(documentTypes, numDocs);

      for (const doc of selectedDocs) {
        const document = documentRepo.create({
          surgery_request_id: request.id,
          created_by: request.responsible_id,
          key: doc.key,
          name: doc.name,
          uri: `documents/${request.protocol}/${doc.key}_${faker.string.uuid()}.pdf`,
        });
        await documentRepo.save(document);
        documentCount++;
      }
    }
  }
  console.log(`✅ ${documentCount} documentos criados\n`);

  // ========== PENDÊNCIAS ==========
  console.log('⚠️ Criando pendências...');
  const pendencyTypes = [
    {
      key: 'document_medical_report',
      name: 'Relatório Médico',
      description: 'Enviar relatório médico detalhado do caso',
    },
    {
      key: 'document_exam_results',
      name: 'Resultados de Exames',
      description: 'Anexar resultados dos exames pré-operatórios',
    },
    {
      key: 'document_authorization',
      name: 'Autorização Pendente',
      description: 'Aguardando autorização do plano de saúde',
    },
    {
      key: 'opme_quotation',
      name: 'Cotação OPME',
      description: 'Solicitar cotação dos materiais OPME necessários',
    },
    {
      key: 'schedule_surgery',
      name: 'Agendamento',
      description: 'Confirmar data e horário da cirurgia',
    },
    {
      key: 'patient_contact',
      name: 'Contato com Paciente',
      description: 'Entrar em contato com o paciente para confirmação',
    },
  ];

  let pendencyCount = 0;
  for (const request of surgeryRequests) {
    if (request.status <= 6) {
      // Apenas solicitações não finalizadas
      const numPendencies = faker.number.int({ min: 0, max: 3 });

      if (numPendencies > 0) {
        const selectedPendencies = faker.helpers.arrayElements(
          pendencyTypes,
          numPendencies,
        );

        for (const pend of selectedPendencies) {
          const isConcluded = faker.datatype.boolean(0.4); // 40% já concluídas

          const pendency = pendencyRepo.create({
            surgery_request_id: request.id,
            responsible_id: request.responsible_id,
            key: pend.key,
            name: pend.name,
            description: pend.description,
            created_manually: faker.datatype.boolean(0.3),
            concluded_at: isConcluded ? faker.date.recent({ days: 10 }) : null,
          });
          await pendencyRepo.save(pendency);
          pendencyCount++;
        }
      }
    }
  }
  console.log(`✅ ${pendencyCount} pendências criadas\n`);

  // ========== COTAÇÕES ==========
  console.log('💰 Criando cotações...');
  let quotationCount = 0;

  for (const request of surgeryRequests) {
    if (request.status >= 3 && request.status <= 8) {
      const numQuotations = faker.number.int({ min: 1, max: 4 });
      const selectedSuppliers = faker.helpers.arrayElements(
        suppliers,
        numQuotations,
      );

      for (let j = 0; j < selectedSuppliers.length; j++) {
        const quotation = quotationRepo.create({
          surgery_request_id: request.id,
          supplier_id: selectedSuppliers[j].id,
          proposal_number: `PROP-${request.protocol}-${j + 1}`,
          submission_date: faker.date.recent({ days: 20 }),
        });
        await quotationRepo.save(quotation);
        quotationCount++;
      }
    }
  }
  console.log(`✅ ${quotationCount} cotações criadas\n`);

  // ========== ATUALIZAÇÕES DE STATUS ==========
  console.log('📊 Criando histórico de status...');
  let statusUpdateCount = 0;

  for (const request of surgeryRequests) {
    // Criar histórico de mudanças de status
    const numUpdates = faker.number.int({ min: 1, max: request.status });
    let prevStatus = 1;

    for (let i = 0; i < numUpdates; i++) {
      const newStatus = Math.min(prevStatus + 1, request.status);

      const statusUpdate = statusUpdateRepo.create({
        surgery_request_id: request.id,
        prev_status: prevStatus,
        new_status: newStatus,
        created_at: new Date(
          request.created_at.getTime() + i * 24 * 60 * 60 * 1000,
        ),
      });
      await statusUpdateRepo.save(statusUpdate);

      prevStatus = newStatus;
      statusUpdateCount++;
    }
  }
  console.log(`✅ ${statusUpdateCount} atualizações de status criadas\n`);

  // ========== CHATS ==========
  console.log('💬 Criando chats...');
  let chatCount = 0;

  for (const request of surgeryRequests) {
    if (request.status >= 2 && faker.datatype.boolean(0.6)) {
      // 60% têm chat
      const chat = chatRepo.create({
        surgery_request_id: request.id,
        user_id: request.patient_id,
      });
      await chatRepo.save(chat);
      chatCount++;

      // Criar mensagens no chat
      const numMessages = faker.number.int({ min: 2, max: 15 });
      const participants = [
        request.patient_id,
        request.doctor_id,
        request.responsible_id,
      ];

      for (let i = 0; i < numMessages; i++) {
        const sender = faker.helpers.arrayElement(participants);
        const isRead = faker.datatype.boolean(0.7); // 70% lidas

        const message = chatMessageRepo.create({
          chat_id: chat.id,
          sent_by: sender,
          read: isRead,
          message: faker.lorem.sentence(),
          created_at: new Date(
            request.created_at.getTime() + i * 12 * 60 * 60 * 1000,
          ),
        });
        await chatMessageRepo.save(message);
      }
    }
  }
  console.log(`✅ ${chatCount} chats criados com mensagens\n`);

  // ========== CÓDIGOS DE RECUPERAÇÃO ==========
  console.log('🔑 Criando códigos de recuperação...');
  let recoveryCodeCount = 0;

  // Criar alguns códigos de recuperação para usuários aleatórios
  const usersWithRecovery = faker.helpers.arrayElements(
    [...doctors, ...collaborators, ...patients],
    15,
  );

  for (const user of usersWithRecovery) {
    const numCodes = faker.number.int({ min: 1, max: 3 });

    for (let i = 0; i < numCodes; i++) {
      const recoveryCode = recoveryCodeRepo.create({
        user_id: user.id,
        code: faker.string.numeric(6),
        used: faker.datatype.boolean(0.6), // 60% já usados
      });
      await recoveryCodeRepo.save(recoveryCode);
      recoveryCodeCount++;
    }
  }
  console.log(`✅ ${recoveryCodeCount} códigos de recuperação criados\n`);

  // ========== RESUMO FINAL ==========
  console.log('═══════════════════════════════════════════════════════');
  console.log('🎉 SEED CONCLUÍDO COM SUCESSO!');
  console.log('═══════════════════════════════════════════════════════\n');

  console.log('📊 RESUMO DOS DADOS CRIADOS:');
  console.log(`   • ${clinics.length} clínicas`);
  console.log(`   • ${cids.length} CIDs`);
  console.log(`   • ${procedures.length} procedimentos`);
  console.log(`   • ${doctors.length} médicos`);
  console.log(`   • ${collaborators.length} colaboradores`);
  console.log(`   • ${hospitals.length} hospitais`);
  console.log(`   • ${patients.length} pacientes`);
  console.log(`   • ${suppliers.length} fornecedores`);
  console.log(`   • ${healthPlans.length} planos de saúde`);
  console.log(`   • ${defaultDocCount} documentos padrão`);
  console.log(`   • ${surgeryRequests.length} solicitações de cirurgia`);
  console.log(`   • ${procedureCount} procedimentos vinculados`);
  console.log(`   • ${opmeCount} itens OPME`);
  console.log(`   • ${documentCount} documentos`);
  console.log(`   • ${pendencyCount} pendências`);
  console.log(`   • ${quotationCount} cotações`);
  console.log(`   • ${statusUpdateCount} atualizações de status`);
  console.log(`   • ${chatCount} chats com mensagens`);
  console.log(`   • ${recoveryCodeCount} códigos de recuperação\n`);

  console.log('🔐 CREDENCIAIS DE TESTE (senha: 123456):');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`   👨‍⚕️ Médico:        medico@inexci.com`);
  console.log(`   👥 Colaborador:    colaborador@inexci.com`);
  console.log(`   🏥 Hospital:       hospital@inexci.com`);
  console.log(`   🤒 Paciente:       paciente@inexci.com`);
  console.log(`   📦 Fornecedor:     fornecedor@inexci.com`);
  console.log(`   💳 Plano de Saúde: plano@inexci.com`);
  console.log('═══════════════════════════════════════════════════════');
  console.log('   Todos os usuários têm a mesma senha: 123456');
  console.log('═══════════════════════════════════════════════════════\n');

  await dataSource.destroy();
}

main().catch((e) => {
  console.error('\n❌ ERRO AO EXECUTAR SEED:', e);
  process.exit(1);
});
