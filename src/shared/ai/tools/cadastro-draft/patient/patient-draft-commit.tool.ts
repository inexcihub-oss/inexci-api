import OpenAI from 'openai';
import { AiTool } from '../../tool.interface';
import { buildToolResult } from '../../tool-result';
import { translateServiceError } from '../../helpers/service-error-translator';
import { CadastroDraftDeps } from '../_types';

export function buildPatientDraftCommitTool(deps: CadastroDraftDeps): AiTool {
  const { draftService, patientRepo, userRepo, patientsService } = deps;
  return {
    name: 'patient_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'patient_draft_commit',
        description:
          'Cria o paciente após confirmação. Exige `confirm=true`. Quando aberto como sub-draft de uma SC, popula `patientId` no draft pai automaticamente.',
        parameters: {
          type: 'object',
          properties: { confirm: { type: 'boolean' } },
          required: ['confirm'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      if (!context.userId) {
        return buildToolResult({ status: 'error', message: 'Acesso negado.' });
      }
      if (!(args as any).confirm) {
        return buildToolResult({
          status: 'pending_confirmation',
          message:
            'Para criar o paciente, chame esta tool com `confirm=true` após confirmação do usuário.',
        });
      }
      const v = await draftService.validate(
        context.conversationId,
        'create_patient',
      );
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam campos obrigatórios: ${v.missing.join(', ')}.`
            : 'Não há rascunho de paciente ativo.',
          nextRequiredFields: v.missing,
        });
      }
      const fields = v.draft.fields;

      if (fields.cpf) {
        const requester = await userRepo.findOne({ id: context.userId } as any);
        if (requester) {
          const ownerId = (requester as any).ownerId;
          const existing = await patientRepo.findMany({
            ownerId,
            cpf: fields.cpf,
          } as any);
          if (existing.length > 0) {
            return buildToolResult({
              status: 'blocked',
              message: `Já existe paciente cadastrado com este CPF: ${existing[0].name}.`,
              data: { existingPatientId: existing[0].id },
            });
          }
        }
      }

      try {
        const created = await patientsService.create(
          {
            name: fields.name!,
            phone: fields.phone!,
            email: fields.email ?? '',
            cpf: fields.cpf ?? undefined,
            gender: fields.gender ?? undefined,
            birthDate: fields.birthDate ?? undefined,
          },
          context.userId,
        );

        await draftService.finalizeCommit(context.conversationId, {
          id: created.id,
          label: created.name,
        });

        return buildToolResult({
          status: 'ok',
          data: { id: created.id, name: created.name },
          message: `Paciente "${created.name}" cadastrado com sucesso.`,
          displayText: `Paciente "${created.name}" cadastrado com sucesso. Retomando o fluxo anterior, se houver.`,
        });
      } catch (err) {
        return buildToolResult({
          status: 'error',
          message: translateServiceError(err),
        });
      }
    },
  };
}
