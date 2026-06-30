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
    assemblyService,
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
            priority: enumKeyToPriority(fields.priority ?? 'LOW'),
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

        // ── Pós-create: popula laudo / TUSS / OPME via SurgeryRequestAssemblyService.
        const { warnings } = assemblyService
          ? await assemblyService.assembleFromExtracted({
              scId: created.id,
              notes: typeof fields.notes === 'string' ? fields.notes : undefined,
              tussItems: Array.isArray(fields.tussItems) ? fields.tussItems : [],
              opmeItems: Array.isArray(fields.opmeItems) ? fields.opmeItems : [],
              userId: context.userId,
            })
          : { warnings: [] as string[] };

        // Recarrega a SC com TODAS as relações reais (procedure, hospital,
        // healthPlan, patient, tussItems, opmeItems, reportSections). Usar
        // labels do draft para o `displayText` causou bugs no passado
        // (mensagem "criada com hospital Bradesco" enquanto o banco não
        // tinha hospital algum). A regra agora é: SÓ mostra ao usuário o
        // que de fato foi persistido.
        const repoWithRelations = surgeryRequestRepo as unknown as {
          findOneWithRelations(
            where: { id: string },
            relations: string[],
          ): Promise<{
            id: string;
            protocol?: string | null;
            patient?: { id?: string; name?: string } | null;
            procedure?: { id?: string; name?: string } | null;
            hospital?: { id?: string; name?: string } | null;
            healthPlan?: { id?: string; name?: string } | null;
            tussItems?: unknown[];
            opmeItems?: unknown[];
            reportSections?: unknown[];
          } | null>;
        };
        const persisted = await repoWithRelations.findOneWithRelations(
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

        // O que foi efetivamente salvo (sem mentir).
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

        // O que ficou faltando (transparência total).
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
