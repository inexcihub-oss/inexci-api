import OpenAI from 'openai';
import { In } from 'typeorm';
import { AiTool } from '../tool.interface';
import { detokenizeArg, tokenizePii } from '../../pii/tool-pii-helpers';
import { translateServiceError } from '../helpers/service-error-translator';
import { buildToolResult } from '../tool-result';
import { WhatsappFlowToolDeps } from './_types';
import { asValidDateString, normalizeCpf, normalizePhone } from './_helpers';

export function buildCreatePatientFromDocumentTool(
  deps: WhatsappFlowToolDeps,
): AiTool {
  const { patientRepo, userRepo, patientsService, documentDeps } = deps;
  return {
    name: 'create_patient_from_document',
    definition: {
      type: 'function',
      function: {
        name: 'create_patient_from_document',
        description:
          'Cria um paciente a partir dos dados extraídos do documento enviado pelo WhatsApp (RG, CPF, ficha de cadastro, etc.). Cadastro mínimo: nome e CPF obrigatórios; telefone/e-mail/data de nascimento/sexo opcionais. Requer `confirm=true`.',
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
                'Telefone do paciente (10 a 13 dígitos, com ou sem máscara). Opcional.',
            },
            email: {
              type: 'string',
              description: 'E-mail do paciente. Opcional.',
            },
            cpf: {
              type: 'string',
              description: 'CPF (11 dígitos, com ou sem máscara). Obrigatório.',
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
                'Se true, executa a criação. Se false ou omitido, mostra preview.',
            },
          },
          required: ['name', 'cpf'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context): Promise<string> {
      const { documentDispatcher } = documentDeps;
      if (!patientsService || !patientRepo || !userRepo) {
        return buildToolResult({
          status: 'blocked',
          message: 'Cadastro de paciente indisponível no momento.',
        });
      }
      if (!context.userId) {
        return buildToolResult({
          status: 'blocked',
          message: 'Acesso negado.',
        });
      }

      const TOOL = 'create_patient_from_document';
      const name = String(detokenizeArg(context, args.name) ?? '').trim();
      if (!name || name.length < 2) {
        return buildToolResult({
          status: 'needs_input',
          message:
            'Parâmetro inválido: `name` é obrigatório (mínimo 2 caracteres).',
          nextRequiredFields: ['name'],
        });
      }

      const cpfDigits = normalizeCpf(detokenizeArg(context, args.cpf));
      if (!cpfDigits) {
        return buildToolResult({
          status: 'needs_input',
          message:
            'Parâmetro inválido: `cpf` é obrigatório e deve conter 11 dígitos.',
          nextRequiredFields: ['cpf'],
        });
      }

      let phoneDigits: string | null = null;
      if (
        args.phone !== undefined &&
        args.phone !== null &&
        args.phone !== ''
      ) {
        phoneDigits = normalizePhone(detokenizeArg(context, args.phone));
        if (!phoneDigits) {
          return buildToolResult({
            status: 'needs_input',
            message:
              'Parâmetro inválido: `phone` deve ter 10 a 13 dígitos quando informado.',
            nextRequiredFields: ['phone'],
          });
        }
      }

      let email: string | null = null;
      if (
        args.email !== undefined &&
        args.email !== null &&
        args.email !== ''
      ) {
        const emailRaw = detokenizeArg(context, args.email);
        email =
          typeof emailRaw === 'string' && /\S+@\S+\.\S+/.test(emailRaw.trim())
            ? emailRaw.trim().toLowerCase()
            : null;
        if (!email) {
          return buildToolResult({
            status: 'needs_input',
            message:
              'Parâmetro inválido: `email` deve ser válido quando informado.',
            nextRequiredFields: ['email'],
          });
        }
      }

      let birthDate: string | null = null;
      if (
        args.birth_date !== undefined &&
        args.birth_date !== null &&
        args.birth_date !== ''
      ) {
        const raw = detokenizeArg(context, args.birth_date);
        const validated = asValidDateString(raw);
        if (!validated) {
          return buildToolResult({
            status: 'needs_input',
            message:
              'Parâmetro inválido: `birth_date` deve estar no formato AAAA-MM-DD.',
            nextRequiredFields: ['birth_date'],
          });
        }
        birthDate = validated;
      }

      let gender: string | null = null;
      if (
        args.gender !== undefined &&
        args.gender !== null &&
        args.gender !== ''
      ) {
        const raw = String(args.gender).trim().toUpperCase();
        if (raw !== 'M' && raw !== 'F') {
          return buildToolResult({
            status: 'needs_input',
            message: 'Parâmetro inválido: `gender` deve ser "M" ou "F".',
            nextRequiredFields: ['gender'],
          });
        }
        gender = raw;
      }

      const accessibleDoctorIds = context.accessibleDoctorIds || [];
      if (!accessibleDoctorIds.length) {
        return buildToolResult({
          status: 'blocked',
          message: 'Você não tem acesso a nenhum médico para criar pacientes.',
        });
      }

      let doctorId: string;
      let doctorName: string | null = null;
      if (accessibleDoctorIds.length === 1) {
        doctorId = accessibleDoctorIds[0];
        const doctor = await userRepo.findOne({ id: doctorId } as any);
        doctorName = doctor?.name || null;
      } else {
        const hint = String(
          detokenizeArg(context, args.doctor_name_or_id) ?? '',
        ).trim();
        if (!hint) {
          const doctors = await userRepo.findMany(
            { id: In(accessibleDoctorIds) } as any,
            0,
            10,
          );
          const list = doctors.map((d, i) => `${i + 1} - ${d.name}`).join('\n');
          return buildToolResult({
            status: 'needs_input',
            message: `Você tem acesso a vários médicos. Informe \`doctor_name_or_id\` para indicar quem é o responsável:\n${list}`,
            nextRequiredFields: ['doctor_name_or_id'],
          });
        }
        const doctors = await userRepo.findMany(
          { id: In(accessibleDoctorIds) } as any,
          0,
          50,
        );
        const isUuid = /^[0-9a-f-]{36}$/i.test(hint);
        const match = isUuid
          ? doctors.find((d) => d.id === hint)
          : doctors.find((d) =>
              (d.name || '').toLowerCase().includes(hint.toLowerCase()),
            );
        if (!match) {
          return buildToolResult({
            status: 'needs_input',
            message: `Médico "${hint}" não encontrado entre os acessíveis a você.`,
            nextRequiredFields: ['doctor_name_or_id'],
          });
        }
        doctorId = match.id;
        doctorName = match.name;
      }
      void doctorId;

      const requestingUser = await userRepo.findOne({
        id: context.userId,
      } as any);
      if (!requestingUser) {
        return buildToolResult({
          status: 'blocked',
          message: 'Usuário solicitante não encontrado.',
        });
      }
      const ownerId = requestingUser.ownerId;

      if (cpfDigits) {
        const existing = await patientRepo.findMany({
          ownerId,
          cpf: cpfDigits,
        } as any);
        if (existing.length > 0) {
          const existingNameToken = tokenizePii(
            context,
            TOOL,
            'patient_name',
            existing[0].name,
          );
          return buildToolResult({
            status: 'blocked',
            message: `Já existe paciente cadastrado nesta clínica com este CPF: ${existingNameToken}.`,
          });
        }
      }

      if (!args.confirm) {
        const previewLines = [
          'Confirme a criação do paciente a partir do documento:',
          `Nome: ${name}`,
          `CPF: ${cpfDigits}`,
        ];
        if (phoneDigits) previewLines.push(`Telefone: ${phoneDigits}`);
        if (email) previewLines.push(`Email: ${email}`);
        if (birthDate) previewLines.push(`Nascimento: ${birthDate}`);
        if (gender) previewLines.push(`Sexo: ${gender}`);
        if (doctorName) previewLines.push(`Médico responsável: ${doctorName}`);
        previewLines.push('', 'Responda "sim" para confirmar.');
        return buildToolResult({
          status: 'pending_confirmation',
          message: previewLines.join('\n'),
          pendingConfirmation: {
            tool: 'create_patient_from_document',
            args: { ...args, confirm: true },
            description: 'cadastrar paciente via documento',
          },
        });
      }

      let created: any;
      try {
        created = await patientsService.create(
          {
            name,
            cpf: cpfDigits,
            phone: phoneDigits ?? undefined,
            email: email ?? undefined,
            gender: gender ?? undefined,
            birthDate: birthDate ?? undefined,
          },
          context.userId,
        );
      } catch (err) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao cadastrar paciente: ${translateServiceError(err)}`,
        });
      }

      if (documentDispatcher && context.phone) {
        const pending = await documentDispatcher.getPending(context.phone);
        if (pending) {
          await documentDispatcher.deleteStoragePath(pending.storagePath);
          await documentDispatcher.clearPending(context.phone);
        }
      }

      const nameToken = tokenizePii(
        context,
        TOOL,
        'patient_name',
        created.name,
      );

      return buildToolResult({
        status: 'ok',
        message: [
          `Paciente ${nameToken} cadastrado com sucesso a partir do documento.`,
          'Posso já abrir a solicitação cirúrgica com todos os dados extraídos do documento (procedimento, TUSS, OPME e laudo)? Responda "sim" para criar agora.',
        ].join('\n'),
        affected: [{ kind: 'patient', id: created.id }],
      });
    },
  };
}
