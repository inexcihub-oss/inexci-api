import OpenAI from 'openai';
import { In } from 'typeorm';
import { AiTool, ToolContext } from './tool.interface';
import { PatientRepository } from '../../../database/repositories/patient.repository';
import { UserRepository } from '../../../database/repositories/user.repository';
import { detokenizeArg, tokenizePii } from '../pii/tool-pii-helpers';
import { EntityResolverService } from '../services/entity-resolver.service';

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
  resolver?: EntityResolverService,
): AiTool[] {
  const entityResolver = resolver ?? new EntityResolverService();

  const getPatientInfo: AiTool = {
    name: 'get_patient_info',
    definition: {
      type: 'function',
      function: {
        name: 'get_patient_info',
        description:
          'Busca dados de um paciente pelo nome (tolerante a typos via fuzzy match) ou ID UUID. Retorna o paciente identificado; quando ambíguo, lista candidatos para o usuário escolher.',
        parameters: {
          type: 'object',
          properties: {
            patient_name_or_id: {
              type: 'string',
              description: 'Nome (completo ou parcial) ou ID UUID do paciente',
            },
          },
          required: ['patient_name_or_id'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const TOOL = 'get_patient_info';
      const requestingUser = await userRepo.findOne({ id: context.userId });
      if (!requestingUser) {
        return 'Usuário solicitante não encontrado.';
      }
      const ownerId = (requestingUser as any).ownerId;

      const rawQuery = String(
        detokenizeArg(context, (args as any).patient_name_or_id) ?? '',
      ).trim();
      if (!rawQuery) {
        return 'Parâmetro inválido: `patient_name_or_id` é obrigatório.';
      }

      let patient: any = null;
      if (rawQuery.match(/^[0-9a-f-]{36}$/i)) {
        patient = await patientRepo.findOne({ id: rawQuery, ownerId } as any);
      }

      const candidates = patient
        ? [patient]
        : await patientRepo.findMany({ ownerId } as any, 0, 500);

      if (!candidates.length) {
        return `Paciente "${rawQuery}" não encontrado.`;
      }

      let resolved: any = patient ?? null;
      let ambiguousCandidates: any[] = [];
      if (!resolved) {
        const result = entityResolver.resolve<any>({
          query: rawQuery,
          candidates,
          getName: (p) => String(p.name ?? ''),
          getId: (p) => String(p.id),
        });
        if (result.status === 'resolved' && result.resolved) {
          resolved = result.resolved.data;
        } else if (result.status === 'ambiguous') {
          ambiguousCandidates = result.candidates.map((c) => c.data);
        }
      }

      if (!resolved && ambiguousCandidates.length) {
        const lines = ambiguousCandidates
          .slice(0, 5)
          .map((p: any, idx) => `${idx + 1}) ${p.name} | id: ${p.id}`);
        return [
          `Mais de um paciente possível para "${rawQuery}". Peça desambiguação:`,
          ...lines,
        ].join('\n');
      }

      if (!resolved) {
        return `Paciente "${rawQuery}" não encontrado.`;
      }

      const patientName: string = String(resolved.name ?? '');
      const cpfToken = (resolved as any).cpf
        ? tokenizePii(context, TOOL, 'cpf', (resolved as any).cpf)
        : 'Não informado';
      const phoneToken = (resolved as any).phone
        ? tokenizePii(context, TOOL, 'phone', (resolved as any).phone)
        : 'Não informado';
      const emailToken = (resolved as any).email
        ? tokenizePii(context, TOOL, 'email', (resolved as any).email)
        : 'Não informado';
      const birthToken = (resolved as any).birthDate
        ? tokenizePii(
            context,
            TOOL,
            'birth_date',
            new Date((resolved as any).birthDate).toLocaleDateString('pt-BR'),
          )
        : null;

      const lines = [
        `*Paciente: ${patientName}* (id: ${resolved.id})`,
        `CPF: ${cpfToken}`,
        `Telefone: ${phoneToken}`,
        `Email: ${emailToken}`,
      ];
      if (birthToken) lines.push(`Nascimento: ${birthToken}`);
      return lines.join('\n');
    },
  };

  const listPatients: AiTool = {
    name: 'list_patients',
    definition: {
      type: 'function',
      function: {
        name: 'list_patients',
        description:
          'Lista pacientes cadastrados na clínica acessíveis ao usuário. Aceita filtro opcional por nome (`search`) e modo de match (`match_mode`). Use SEMPRE esta tool antes de afirmar que um paciente não existe ou que não há pacientes cadastrados. O modo `fuzzy` (padrão) tolera typos e erros de transcrição; use `prefix` quando o usuário disser "começa com" / "começam com", `exact` para nome integral, ou `contains` para substring estrita.',
        parameters: {
          type: 'object',
          properties: {
            search: {
              type: 'string',
              description:
                'Texto para filtrar por nome do paciente (acento e caixa são ignorados). Opcional.',
            },
            match_mode: {
              type: 'string',
              enum: ['fuzzy', 'contains', 'prefix', 'exact'],
              description:
                'Modo de comparação: `fuzzy` (similaridade tolerante a typos, padrão), `contains` (substring), `prefix` (começa com) ou `exact` (igual).',
            },
            limit: {
              type: 'number',
              description:
                'Quantidade máxima de resultados (1 a 50, padrão 10).',
            },
          },
          required: [],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const TOOL = 'list_patients';
      const requestingUser = await userRepo.findOne({ id: context.userId });
      if (!requestingUser) {
        return 'Usuário solicitante não encontrado.';
      }
      const ownerId = (requestingUser as any).ownerId;

      const limit = Math.min(
        Math.max(
          typeof args.limit === 'number' ? Math.floor(args.limit) : 10,
          1,
        ),
        50,
      );
      const searchRaw = String(
        detokenizeArg(context, args.search) ?? '',
      ).trim();

      const matchModeRaw =
        typeof args.match_mode === 'string'
          ? args.match_mode.trim().toLowerCase()
          : 'fuzzy';
      const matchMode: 'contains' | 'prefix' | 'exact' | 'fuzzy' =
        matchModeRaw === 'prefix' ||
        matchModeRaw === 'exact' ||
        matchModeRaw === 'contains' ||
        matchModeRaw === 'fuzzy'
          ? (matchModeRaw as 'contains' | 'prefix' | 'exact' | 'fuzzy')
          : 'fuzzy';

      const normalize = (text: string): string =>
        text
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim()
          .toLowerCase();

      const search = normalize(searchRaw);

      const all = await patientRepo.findMany({ ownerId } as any, 0, 500);

      let filtered: any[];
      if (!search) {
        filtered = all;
      } else if (matchMode === 'fuzzy') {
        const resolverResult = entityResolver.resolve<any>({
          query: searchRaw,
          candidates: all,
          getName: (p: any) => String(p.name ?? ''),
          getId: (p: any) => String(p.id),
          candidateThreshold: 0.5,
          maxCandidates: limit,
        });
        if (resolverResult.status === 'resolved' && resolverResult.resolved) {
          filtered = [
            resolverResult.resolved.data,
            ...resolverResult.candidates.map((c) => c.data),
          ];
        } else if (resolverResult.status === 'ambiguous') {
          filtered = resolverResult.candidates.map((c) => c.data);
        } else {
          filtered = [];
        }
      } else {
        filtered = all.filter((p: any) => {
          const name = normalize(String(p.name || ''));
          if (!name) return false;
          if (matchMode === 'exact') return name === search;
          if (matchMode === 'prefix') return name.startsWith(search);
          return name.includes(search);
        });
      }

      if (!filtered.length) {
        if (search) {
          const hint =
            matchMode === 'prefix'
              ? `nenhum começa com "${searchRaw}"`
              : matchMode === 'exact'
                ? `nenhum tem nome exatamente "${searchRaw}"`
                : matchMode === 'fuzzy'
                  ? `nenhum se parece com "${searchRaw}"`
                  : `nenhum contém "${searchRaw}"`;
          return `Nenhum paciente encontrado: ${hint}.`;
        }
        return 'Nenhum paciente cadastrado nesta clínica ainda.';
      }

      const slice = filtered.slice(0, limit);
      const lines = slice.map((p: any) => {
        const phoneToken = (p as any).phone
          ? tokenizePii(context, TOOL, 'phone', (p as any).phone)
          : 'sem telefone';
        return `${p.name} | id: ${p.id} | telefone: ${phoneToken}`;
      });

      const modeLabel =
        matchMode === 'prefix'
          ? 'começam com'
          : matchMode === 'exact'
            ? 'exatamente'
            : matchMode === 'fuzzy'
              ? 'se parecem com'
              : 'contêm';

      const header = search
        ? `Pacientes que ${modeLabel} "${searchRaw}" (${filtered.length}):`
        : `Pacientes cadastrados (${filtered.length}, mostrando ${slice.length}):`;
      return [header, ...lines].join('\n');
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

  return [getPatientInfo, listPatients, createPatient];
}
