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
    opmeService,
    tussService,
    hospitalRepo,
    healthPlanRepo,
    entityResolver,
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
      try {
        await autoFillDoctorIfSingle(draftService, userRepo, context);
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao preparar rascunho: ${err?.message || 'erro desconhecido'}`,
          errors: [{ code: 'AUTOFILL_FAILED', message: String(err?.message ?? err) }],
        });
      }

      let validation;
      try {
        validation = await draftService.validate(context.conversationId, 'create_sc');
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao validar rascunho: ${err?.message || 'erro desconhecido'}`,
          errors: [{ code: 'VALIDATE_FAILED', message: String(err?.message ?? err) }],
        });
      }

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
        const requestingUser = await userRepo
          .findOne({ id: context.userId } as any)
          .catch(() => null);
        const ownerId = requestingUser?.ownerId ?? null;

        const hospitalResolution = await resolveCatalogEntityId({
          explicitId: fields.hospitalId,
          label: fields.hospitalLabel,
          ownerId,
          kindLabel: 'hospital',
          repo: hospitalRepo,
          entityResolver,
        });
        const healthPlanResolution = await resolveCatalogEntityId({
          explicitId: fields.healthPlanId,
          label: fields.healthPlanLabel,
          ownerId,
          kindLabel: 'convênio',
          repo: healthPlanRepo,
          entityResolver,
        });

        const created = await surgeryRequestsService.createSurgeryRequest(
          {
            doctorId,
            patientId: fields.patientId!,
            procedureId: fields.procedureId!,
            priority: enumKeyToPriority(fields.priority ?? 'LOW'),
            hospitalId: hospitalResolution.id ?? undefined,
            healthPlanId: healthPlanResolution.id ?? undefined,
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

        // ── Pós-create: popula laudo / TUSS / OPME quando o draft trouxe
        // esses dados (tipicamente vindos do classificador de documentos).
        // Tudo é best-effort: falhas individuais não derrubam a criação
        // da SC; apenas registramos em `warnings` para a mensagem final.
        const warnings: string[] = [];

        if (hospitalResolution.warning) {
          warnings.push(hospitalResolution.warning);
        }
        if (healthPlanResolution.warning) {
          warnings.push(healthPlanResolution.warning);
        }

        if (fields.notes && typeof fields.notes === 'string') {
          try {
            await surgeryRequestsService.createReportSection(
              created.id,
              { title: 'Laudo', description: fields.notes },
              context.userId,
            );
          } catch (err: any) {
            warnings.push(`laudo (${err?.message || 'erro'})`);
          }
        }

        const tussList = Array.isArray(fields.tussItems)
          ? fields.tussItems
          : [];
        let tussAdded = 0;
        for (const item of tussList) {
          const code = item?.code;
          if (!code) continue;
          let name = item.description;
          if (!name && tussService) {
            try {
              const matches = tussService.lookup(code, 1);
              if (matches?.[0]?.name) name = matches[0].name;
            } catch {
              // catálogo indisponível — segue sem descrição
            }
          }
          if (!name) {
            warnings.push(`TUSS ${code} (descrição não resolvida)`);
            continue;
          }
          try {
            await surgeryRequestsService.addTussItem(
              created.id,
              { tussCode: code, name, quantity: 1 },
              context.userId,
            );
            tussAdded += 1;
          } catch (err: any) {
            warnings.push(`TUSS ${code} (${err?.message || 'erro'})`);
          }
        }

        const opmeList = Array.isArray(fields.opmeItems)
          ? fields.opmeItems
          : [];
        let opmeAdded = 0;
        for (const item of opmeList) {
          const name = item?.description;
          if (!name) continue;
          // OPME na plataforma exige >=3 fabricantes e >=3 fornecedores.
          // Quando o documento traz apenas 1 fornecedor/marca, ainda
          // criamos o item com placeholders "a definir" — o usuário
          // refina pela interface depois.
          const supplierBase = item.supplier ? [item.supplier] : ['A definir'];
          const brandBase = item.brand ? [item.brand] : ['A definir'];
          const supplierNames = [
            ...supplierBase,
            'A definir',
            'A definir',
          ].slice(0, Math.max(3, supplierBase.length));
          const manufacturerNames = [
            ...brandBase,
            'A definir',
            'A definir',
          ].slice(0, Math.max(3, brandBase.length));
          if (!opmeService) {
            warnings.push(`OPME ${name} (serviço indisponível)`);
            continue;
          }
          try {
            await opmeService.create(
              {
                surgeryRequestId: created.id,
                name,
                brand: manufacturerNames.join(', '),
                quantity: typeof item.qty === 'number' ? item.qty : 1,
                supplierNames,
              },
              context.userId,
            );
            opmeAdded += 1;
          } catch (err: any) {
            warnings.push(`OPME ${name} (${err?.message || 'erro'})`);
          }
        }

        if (opmeAdded > 0) {
          try {
            await surgeryRequestsService.setHasOpme(
              created.id,
              true,
              context.userId,
            );
          } catch {
            // não-crítico
          }
        }

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

async function resolveCatalogEntityId(opts: {
  explicitId: unknown;
  label: unknown;
  ownerId: string | null;
  kindLabel: 'hospital' | 'convênio';
  repo?: {
    findByOwnerId(
      ownerId: string,
    ): Promise<Array<{ id: string; name: string }>>;
    findMany(
      where: any,
      skip?: number,
      take?: number,
    ): Promise<Array<{ id: string; name: string }>>;
  };
  entityResolver?: {
    resolve<T>(opts: {
      query: string;
      candidates: T[];
      getName: (item: T) => string;
      getId: (item: T) => string;
    }): {
      status: 'resolved' | 'ambiguous' | 'not_found' | 'error';
      resolved?: { id: string };
      candidates: Array<{ label: string }>;
    };
  };
}): Promise<{ id?: string; warning?: string }> {
  const explicitId =
    typeof opts.explicitId === 'string' ? opts.explicitId.trim() : '';
  if (explicitId) return { id: explicitId };

  const label = typeof opts.label === 'string' ? opts.label.trim() : '';
  if (!label || !opts.repo) return {};

  let candidates: Array<{ id: string; name: string }> = [];
  try {
    candidates = opts.ownerId
      ? await opts.repo.findByOwnerId(opts.ownerId)
      : await opts.repo.findMany({} as any, 0, 200);
  } catch {
    return {
      warning: `${opts.kindLabel} (${label}) não pôde ser resolvido automaticamente`,
    };
  }

  if (!candidates.length) {
    return {
      warning: `${opts.kindLabel} (${label}) não encontrado no catálogo`,
    };
  }

  if (opts.entityResolver) {
    const resolved = opts.entityResolver.resolve({
      query: label,
      candidates,
      getName: (c) => c.name,
      getId: (c) => c.id,
    });
    if (resolved.status === 'resolved' && resolved.resolved?.id) {
      return { id: resolved.resolved.id };
    }
    if (resolved.status === 'ambiguous') {
      const sample = resolved.candidates
        .slice(0, 3)
        .map((c) => c.label)
        .join(', ');
      return {
        warning: `${opts.kindLabel} (${label}) ambíguo no catálogo${sample ? `: ${sample}` : ''}`,
      };
    }
    return {
      warning: `${opts.kindLabel} (${label}) não encontrado no catálogo`,
    };
  }

  const exact = candidates.find(
    (c) => (c.name || '').trim().toLowerCase() === label.toLowerCase(),
  );
  if (exact) return { id: exact.id };

  return {
    warning: `${opts.kindLabel} (${label}) não encontrado no catálogo`,
  };
}
