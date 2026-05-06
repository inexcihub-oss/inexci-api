import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import { PatientRepository } from '../../../database/repositories/patient.repository';

function maskCpf(cpf: string): string {
  if (!cpf || cpf.length < 11) return '***.***.***-**';
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

export function buildGeneralTools(patientRepo: PatientRepository): AiTool[] {
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

      return [
        `👤 *Paciente: ${patient.name}*`,
        `CPF: ${maskCpf((patient as any).cpf || '')}`,
        `Telefone: ${(patient as any).phone || 'Não informado'}`,
        `Email: ${(patient as any).email || 'Não informado'}`,
      ].join('\n');
    },
  };

  return [getPatientInfo];
}
