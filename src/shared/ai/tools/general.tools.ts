import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import { PatientRepository } from '../../../database/repositories/patient.repository';
import { tokenizePii } from '../pii/tool-pii-helpers';

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
      const birthToken = (patient as any).birth_date
        ? tokenizePii(
            context,
            TOOL,
            'birth_date',
            new Date((patient as any).birth_date).toLocaleDateString('pt-BR'),
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

  return [getPatientInfo];
}
