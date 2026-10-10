import { AiTool, ToolContext } from '../tool.interface';
import { Permission } from 'src/shared/permissions';
import { buildToolResult } from '../tool-result';
import { formatScProtocolForDisplay } from '../protocol.helpers';
import { ScDraftToolDeps } from './_types';
import { autoFillDoctorIfSingle, enumKeyToPriority } from './_helpers';
import { recordAiActivity } from '../helpers/surgery-request-access';
import { errorMessage } from '../../../utils/error-message.util';

export function buildScDraftCommitTool(deps: ScDraftToolDeps): AiTool {
  const {
    draftService,
    userRepo,
    surgeryRequestRepo,
    surgeryRequestsService,
    activityRepo,
    assemblyService,
  } = deps;
  return {
    name: 'sc_draft_commit',
    requiredPermission: Permission.SOLICITACOES,
    mutates: true,
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
    },
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId)
        return buildToolResult({ status: 'error', message: 'Acesso negado.' });
      if (!args.confirm) {
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
            priority: enumKeyToPriority(fields.priority ?? 'LOW'),
            hospitalId: fields.hospitalId ?? undefined,
            healthPlanId: fields.healthPlanId ?? undefined,
          },
          context.userId,
        );
        await recordAiActivity(
          activityRepo,
          context,
          created.id,
          'Solicitação criada via rascunho estruturado (sc_draft).',
        );

        const { warnings } = await assemblyService.assembleFromExtracted({
          scId: created.id,
          notes: typeof fields.notes === 'string' ? fields.notes : undefined,
          tussItems: Array.isArray(fields.tussItems) ? fields.tussItems : [],
          opmeItems: Array.isArray(fields.opmeItems) ? fields.opmeItems : [],
          userId: context.userId,
        });

        const persisted = await surgeryRequestRepo.findOneWithRelations(
          { id: created.id },
          [
            'patient',
            'procedure',
            'hospital',
            'healthPlan',
            'tussItems',
            'opmeItems',
            'reportSections',
          ],
        );
        const protocol = formatScProtocolForDisplay(
          persisted?.protocol ?? created.protocol,
        );

        await draftService.finalizeCommit(context.conversationId, {
          id: created.id,
          label: protocol,
        });

        const linesOk: string[] = [
          'Solicitação cirúrgica criada com sucesso!',
          `• Protocolo: ${protocol}`,
        ];
        if (persisted?.patient?.name)
          linesOk.push(`• Paciente: ${persisted.patient.name}`);
        if (persisted?.procedure?.name)
          linesOk.push(`• Procedimento: ${persisted.procedure.name}`);

        const persistedTussCount = Array.isArray(persisted?.tussItems)
          ? persisted.tussItems.length
          : 0;
        const persistedOpmeCount = Array.isArray(persisted?.opmeItems)
          ? persisted.opmeItems.length
          : 0;
        const persistedReportCount = Array.isArray(persisted?.reportSections)
          ? persisted.reportSections.length
          : 0;

        if (persisted?.hospital?.name)
          linesOk.push(`• Hospital: ${persisted.hospital.name}`);
        if (persisted?.healthPlan?.name)
          linesOk.push(`• Convênio: ${persisted.healthPlan.name}`);
        if (persistedTussCount > 0)
          linesOk.push(
            `• TUSS: ${persistedTussCount} item${persistedTussCount > 1 ? 's' : ''}`,
          );
        if (persistedOpmeCount > 0)
          linesOk.push(
            `• OPME: ${persistedOpmeCount} item${persistedOpmeCount > 1 ? 's' : ''}`,
          );
        if (persistedReportCount > 0)
          linesOk.push(`• Laudo: ${persistedReportCount} seção(ões)`);

        const pendingForSend: string[] = [];
        if (!persisted?.hospital?.id) pendingForSend.push('hospital');
        if (!persisted?.healthPlan?.id) pendingForSend.push('convênio');
        if (persistedTussCount === 0) pendingForSend.push('TUSS');
        if (persistedOpmeCount === 0) pendingForSend.push('OPME');
        if (persistedReportCount === 0) pendingForSend.push('laudo');

        let pendingBlock = '';
        if (pendingForSend.length > 0) {
          pendingBlock = `\n\nFaltam para conseguir enviar para análise: ${pendingForSend.join(', ')}. Quer que eu te ajude a completar agora?`;
        }

        const warningBlock = warnings.length
          ? `\n\n⚠ Não consegui registrar: ${warnings.join('; ')}.`
          : '';

        return buildToolResult({
          status: 'ok',
          affected: [{ kind: 'surgery_request', id: created.id }],
          data: {
            id: created.id,
            protocol,
            persistedCounts: {
              tuss: persistedTussCount,
              opme: persistedOpmeCount,
              reportSections: persistedReportCount,
            },
          },
          message: `Solicitação ${protocol} criada com sucesso.`,
          displayText: linesOk.join('\n') + warningBlock + pendingBlock,
        });
      } catch (err) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao criar SC: ${errorMessage(err) || 'erro desconhecido'}`,
          errors: [{ code: 'CREATE_SC_FAILED', message: errorMessage(err) }],
        });
      }
    },
  };
}
