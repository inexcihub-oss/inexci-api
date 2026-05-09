import OpenAI from 'openai';
import { In } from 'typeorm';
import { AiTool, ToolContext } from './tool.interface';
import { PatientRepository } from '../../../database/repositories/patient.repository';
import { UserRepository } from '../../../database/repositories/user.repository';
import { detokenizeArg, tokenizePii } from '../pii/tool-pii-helpers';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BIRTH_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function normalizePhoneDigits(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 13) return null;
  return digits;
}

function normalizeCpfDigits(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length !== 11) return null;
  if (/^(\d)\1{10}$/.test(digits)) return null;
  const verifyDigit = (slice: string, factorStart: number): number => {
    let sum = 0;
    for (let i = 0; i < slice.length; i++) {
      sum += Number(slice[i]) * (factorStart - i);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  const dv1 = verifyDigit(digits.slice(0, 9), 10);
  const dv2 = verifyDigit(digits.slice(0, 10), 11);
  if (dv1 !== Number(digits[9]) || dv2 !== Number(digits[10])) return null;
  return digits;
}

function normalizeBirthDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!BIRTH_DATE_REGEX.test(raw)) return null;
  const [year, month, day] = raw.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  if (date.getTime() > Date.now()) return null;
  if (year < 1900) return null;
  return raw;
}

function normalizeEmail(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  if (!EMAIL_REGEX.test(raw)) return null;
  return raw;
}

function formatPhoneDisplay(digits: string): string {
  const local =
    digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits;
  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return digits;
}

function formatCpfDisplay(digits: string): string {
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function buildGeneralTools(
  patientRepo: PatientRepository,
  userRepo: UserRepository,
): AiTool[] {
  const getPatientInfo: AiTool = {
    name: 'get_patient_info',
    definition: {
      type: 'function',
      function: {
        name: 'get_patient_info',
        description: 'Busca dados de um paciente pelo nome ou ID.',
        parameters: {
          type: 'object',
          properties: {
            patient_name_or_id: {
              type: 'string',
              description: 'Nome ou ID UUID do paciente',
            },
          },
          required: ['patient_name_or_id'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const { patient_name_or_id } = args as { patient_name_or_id: string };
      let patient = null;

      if (patient_name_or_id.match(/^[0-9a-f-]{36}$/i)) {
        patient = await patientRepo.findOne({ id: patient_name_or_id });
      }

      if (!patient) {
        const all = await patientRepo.findMany({}, 0, 50);
        patient = all.find((p: any) =>
          p.name?.toLowerCase().includes(patient_name_or_id.toLowerCase()),
        );
      }

      if (!patient) {
        return `Paciente "${patient_name_or_id}" não encontrado.`;
      }

      const TOOL = 'get_patient_info';
      const nameToken = tokenizePii(
        context,
        TOOL,
        'patient_name',
        patient.name,
      );
      const cpfToken = (patient as any).cpf
        ? tokenizePii(context, TOOL, 'cpf', (patient as any).cpf)
        : 'Não informado';
      const phoneToken = (patient as any).phone
        ? tokenizePii(context, TOOL, 'phone', (patient as any).phone)
        : 'Não informado';
      const emailToken = (patient as any).email
        ? tokenizePii(context, TOOL, 'email', (patient as any).email)
        : 'Não informado';
      const birthToken = (patient as any).birthDate
        ? tokenizePii(
            context,
            TOOL,
            'birth_date',
            new Date((patient as any).birthDate).toLocaleDateString('pt-BR'),
          )
        : null;

      const lines = [
        `👤 *Paciente: ${nameToken}*`,
        `CPF: ${cpfToken}`,
        `Telefone: ${phoneToken}`,
        `Email: ${emailToken}`,
      ];
      if (birthToken) lines.push(`Nascimento: ${birthToken}`);
      return lines.join('\n');
    },
  };

  const createPatient: AiTool = {
    name: 'create_patient',
    definition: {
      type: 'function',
      function: {
        name: 'create_patient',
        description:
          'Cria um novo paciente vinculado ao médico do usuário a partir do cadastro mínimo via WhatsApp (nome, telefone e e-mail obrigatórios). Demais campos (CPF, data de nascimento, sexo, endereço, CEP) podem ser preenchidos depois — o paciente fica com a pendência "Dados do Paciente" em aberto até completar tudo. Sem confirm=true, retorna apenas um preview (NUNCA cria sem confirmação explícita).',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Nome completo do paciente (obrigatório).',
            },
            phone: {
              type: 'string',
              description:
                'Telefone do paciente (10 a 13 dígitos, com ou sem máscara). Obrigatório.',
            },
            email: {
              type: 'string',
              description: 'E-mail do paciente. Obrigatório.',
            },
            cpf: {
              type: 'string',
              description:
                'CPF do paciente (11 dígitos, com ou sem máscara). Opcional.',
            },
            birth_date: {
              type: 'string',
              description:
                'Data de nascimento no formato AAAA-MM-DD. Opcional.',
            },
            gender: {
              type: 'string',
              enum: ['M', 'F'],
              description: 'M (masculino) ou F (feminino). Opcional.',
            },
            doctor_name_or_id: {
              type: 'string',
              description:
                'Nome ou ID do médico responsável. Obrigatório quando o usuário tem acesso a múltiplos médicos.',
            },
            confirm: {
              type: 'boolean',
              description:
                'Se true, executa a criação. Se false ou omitido, apenas mostra o preview.',
            },
          },
          required: ['name', 'phone', 'email'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const TOOL = 'create_patient';

      const name = String(detokenizeArg(context, args.name) ?? '').trim();
      if (!name || name.length < 2) {
        return 'Parâmetro inválido: `name` é obrigatório (mínimo 2 caracteres).';
      }

      const phoneDigits = normalizePhoneDigits(
        detokenizeArg(context, args.phone),
      );
      if (!phoneDigits) {
        return 'Parâmetro inválido: `phone` é obrigatório e deve conter de 10 a 13 dígitos (com ou sem máscara).';
      }

      const email = normalizeEmail(detokenizeArg(context, args.email));
      if (!email) {
        return 'Parâmetro inválido: `email` é obrigatório e deve estar em formato válido.';
      }

      let cpfDigits: string | null = null;
      if (args.cpf !== undefined && args.cpf !== null && args.cpf !== '') {
        cpfDigits = normalizeCpfDigits(detokenizeArg(context, args.cpf));
        if (!cpfDigits) {
          return 'Parâmetro inválido: `cpf` deve conter 11 dígitos válidos (DV correto).';
        }
      }

      let birthDate: string | null = null;
      if (
        args.birth_date !== undefined &&
        args.birth_date !== null &&
        args.birth_date !== ''
      ) {
        birthDate = normalizeBirthDate(detokenizeArg(context, args.birth_date));
        if (!birthDate) {
          return 'Parâmetro inválido: `birth_date` deve estar no formato AAAA-MM-DD e ser uma data válida não futura.';
        }
      }

      let gender: string | null = null;
      if (
        args.gender !== undefined &&
        args.gender !== null &&
        args.gender !== ''
      ) {
        const raw = String(args.gender).trim().toUpperCase();
        if (raw !== 'M' && raw !== 'F') {
          return 'Parâmetro inválido: `gender` deve ser "M" ou "F".';
        }
        gender = raw;
      }

      const accessibleDoctorIds = context.accessibleDoctorIds || [];
      if (accessibleDoctorIds.length === 0) {
        return 'Você não tem acesso a nenhum médico para criar pacientes.';
      }

      let doctorId: string;
      let doctorName: string | null = null;
      if (accessibleDoctorIds.length === 1) {
        doctorId = accessibleDoctorIds[0];
        const doctor = await userRepo.findOne({ id: doctorId });
        doctorName = doctor?.name || null;
      } else {
        const hint = String(
          detokenizeArg(context, args.doctor_name_or_id) ?? '',
        ).trim();
        if (!hint) {
          const doctors = await userRepo.findMany(
            { id: In(accessibleDoctorIds) },
            0,
            10,
          );
          const list = doctors.map((d, i) => `${i + 1} - ${d.name}`).join('\n');
          return `Você tem acesso a vários médicos. Informe \`doctor_name_or_id\` para indicar quem é o responsável:\n${list}`;
        }
        const doctors = await userRepo.findMany(
          { id: In(accessibleDoctorIds) },
          0,
          50,
        );
        const match = hint.match(/^[0-9a-f-]{36}$/i)
          ? doctors.find((d) => d.id === hint)
          : doctors.find((d) =>
              d.name?.toLowerCase().includes(hint.toLowerCase()),
            );
        if (!match) {
          return `Médico "${hint}" não encontrado entre os acessíveis a você.`;
        }
        doctorId = match.id;
        doctorName = match.name;
      }

      const requestingUser = await userRepo.findOne({ id: context.userId });
      if (!requestingUser) {
        return 'Usuário solicitante não encontrado.';
      }
      const ownerId = requestingUser.ownerId;

      if (cpfDigits) {
        const existing = await patientRepo.findMany({
          ownerId,
          cpf: cpfDigits,
        });
        if (existing.length > 0) {
          const existingNameToken = tokenizePii(
            context,
            TOOL,
            'patient_name',
            existing[0].name,
          );
          return `Já existe paciente cadastrado nesta clínica com este CPF: ${existingNameToken}.`;
        }
      }

      const missingForCompletion: string[] = [];
      if (!birthDate) missingForCompletion.push('data de nascimento');
      if (!cpfDigits) missingForCompletion.push('CPF');

      if (!args.confirm) {
        const previewLines = [
          `Confirme a criação do paciente:`,
          `Nome: ${name}`,
          `Telefone: ${formatPhoneDisplay(phoneDigits)}`,
          `Email: ${email}`,
        ];
        if (cpfDigits) previewLines.push(`CPF: ${formatCpfDisplay(cpfDigits)}`);
        if (birthDate) previewLines.push(`Nascimento: ${birthDate}`);
        if (gender) previewLines.push(`Sexo: ${gender}`);
        if (doctorName) previewLines.push(`Médico responsável: ${doctorName}`);
        if (missingForCompletion.length) {
          previewLines.push(
            '',
            `Atenção: o paciente ficará com a pendência "Dados do Paciente" em aberto até completar: ${missingForCompletion.join(', ')}, endereço e CEP.`,
          );
        }
        previewLines.push('', 'Responda "sim" para confirmar.');
        return previewLines.join('\n');
      }

      const created = await patientRepo.create({
        doctorId,
        ownerId,
        name,
        phone: phoneDigits,
        email,
        cpf: cpfDigits,
        gender,
        birthDate: birthDate ? new Date(`${birthDate}T00:00:00Z`) : null,
        active: true,
      } as any);

      const nameToken = tokenizePii(
        context,
        TOOL,
        'patient_name',
        created.name,
      );
      const phoneToken = tokenizePii(context, TOOL, 'phone', created.phone);
      const emailToken = tokenizePii(context, TOOL, 'email', created.email);
      const cpfToken = created.cpf
        ? tokenizePii(context, TOOL, 'cpf', created.cpf)
        : null;

      const lines = [
        `Paciente ${nameToken} cadastrado com sucesso.`,
        `Telefone: ${phoneToken}`,
        `Email: ${emailToken}`,
      ];
      if (cpfToken) lines.push(`CPF: ${cpfToken}`);
      if (birthDate) lines.push(`Nascimento: ${birthDate}`);

      if (missingForCompletion.length) {
        lines.push(
          '',
          `Pendência aberta "Dados do Paciente": faltam ${missingForCompletion.join(', ')}, endereço e CEP. Complete na plataforma ou peça-me para atualizar usando update_patient_data.`,
        );
      }
      return lines.join('\n');
    },
  };

  return [getPatientInfo, createPatient];
}
