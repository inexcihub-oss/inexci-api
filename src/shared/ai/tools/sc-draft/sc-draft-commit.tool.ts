import OpenAI from 'openai';
import { AiTool, ToolContext } from '../tool.interface';
import { buildToolResult } from '../tool-result';
import { ActivityType } from '../../../../database/entities/surgery-request-activity.entity';
import { formatScProtocolForDisplay } from '../protocol.helpers';
import { ScDraftToolDeps } from './_types';
import { autoFillDoctorIfSingle, enumKeyToPriority } from './_helpers';

export function buildScDraftCommitTool(deps: ScDraftToolDeps): AiTool {
  const {
    draftService,
    userRepo,
    surgeryRequestRepo,
    surgeryRequestsService,
    activityRepo,
  } = deps;
  return {
    name: 'sc_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'sc_draft_commit',
        description:
          'Cria de fato a SC com os dados do rascunho. Só execute após `sc_draft_preview` e confirmação do usuário ("sim").',
        parameters: {
          type: 'object',
          properties: {
            confirm: {
              type: 'boolean',
              description:
                'Precisa ser `true`. Sem isso, devolve apenas o preview.',
            },
          },
          required: ['confirm'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId)
        return buildToolResult({ status: 'error', message: 'Acesso negado.' });
      if (!(args as any).confirm) {
        return buildToolResult({
          status: 'pending_confirmation',
          message:
            'Para criar a SC, chame esta tool com `confirm=true` após receber confirmação do usuário.',
        });
      }
      await autoFillDoctorIfSingle(draftService, userRepo, context);
      const validation = await draftService.validate(
        context.conversationId,
        'create_sc',
      );
      if (!validation.isReady || !validation.draft) {
        return buildToolResult({
          status: 'blocked',
          message: validation.draft
            ? `Faltam campos obrigatórios: ${validation.missing.join(', ')}.`
            : 'Não há rascunho de SC ativo.',
          nextRequiredFields: validation.missing,
        });
      }

      const fields = validation.draft.fields;
      let doctorId = fields.doctorId;
      if (!doctorId) {
        const accessible = context.accessibleDoctorIds || [];
        if (accessible.length === 1) {
          doctorId = accessible[0];
        } else {
          return buildToolResult({
            status: 'needs_input',
            message:
              'Você tem acesso a múltiplos médicos — informe o médico responsável com `draft_update(create_sc, doctorId, <UUID>)`.',
            nextRequiredFields: ['doctorId'],
          });
        }
      }

      try {
        const created = await surgeryRequestsService.createSurgeryRequest(
          {
            doctorId,
            patientId: fields.patientId!,
            procedureId: fields.procedureId!,
            priority: enumKeyToPriority(fields.priority!),
            hospitalId: fields.hospitalId ?? undefined,
            healthPlanId: fields.healthPlanId ?? undefined,
          },
          context.userId,
        );
        await activityRepo.create({
          surgeryRequestId: created.id,
          userId: context.userId,
          type: ActivityType.SYSTEM,
          content:
            '[WhatsApp IA] Solicitação criada via rascunho estruturado (sc_draft).',
        });
        const persisted = await surgeryRequestRepo.findOneSimple({
          id: created.id,
        } as any);
        const protocol = formatScProtocolForDisplay(
          persisted?.protocol ?? created.protocol,
        );

        await draftService.finalizeCommit(context.conversationId, {
          id: created.id,
          label: protocol,
        });

        return buildToolResult({
          status: 'ok',
          data: { id: created.id, protocol },
          message: `Solicitação ${protocol} criada com sucesso.`,
          displayText: [
            'Solicitação cirúrgica criada com sucesso!',
            `• Protocolo: ${protocol}`,
            fields.patientLabel ? `• Paciente: ${fields.patientLabel}` : null,
            fields.procedureLabel
              ? `• Procedimento: ${fields.procedureLabel}`
              : null,
            fields.hospitalLabel ? `• Hospital: ${fields.hospitalLabel}` : null,
            fields.healthPlanLabel
              ? `• Convênio: ${fields.healthPlanLabel}`
              : null,
          ]
            .filter(Boolean)
            .join('\n'),
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao criar SC: ${err?.message || 'erro desconhecido'}`,
          errors: [
            { code: 'CREATE_SC_FAILED', message: String(err?.message ?? err) },
          ],
        });
      }
    },
  };
}
