import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import { detokenizeArg, tokenizePii } from '../pii/tool-pii-helpers';
import { EntityResolverService } from '../services/entity-resolver.service';
import { PatientsService } from '../../../modules/patients/patients.service';

export function buildGeneralTools(
  patientsService: PatientsService,
  resolver?: EntityResolverService,
): AiTool[] {
  const entityResolver = resolver ?? new EntityResolverService();

  /**
   * `query_patients` substitui as antigas `get_patient_info` + `list_patients`
   * (removidas em Mai/2026 — Fase 4.1 do PLANO-CONSOLIDACAO-TOOLS-IA-VIA-SERVICES-REST).
   *
   * - Quando `patient_name_or_id` é um UUID → detalhe completo do paciente.
   * - Quando fornecido como texto → busca por nome com o `match_mode` escolhido.
   * - Sem parâmetros → lista todos os pacientes da clínica.
   */
  const queryPatients: AiTool = {
    name: 'query_patients',
    definition: {
      type: 'function',
      function: {
        name: 'query_patients',
        description:
          'Busca pacientes da clínica. Sem parâmetros lista todos. Com `patient_name_or_id` busca por nome (fuzzy por padrão) ou retorna o detalhe completo quando for UUID. Use SEMPRE antes de afirmar que um paciente não existe.',
        parameters: {
          type: 'object',
          properties: {
            patient_name_or_id: {
              type: 'string',
              description:
                'Nome (completo ou parcial) ou UUID do paciente. Quando for UUID retorna o detalhe (CPF, telefone, e-mail, nascimento). Quando for texto faz busca.',
            },
            match_mode: {
              type: 'string',
              enum: ['fuzzy', 'contains', 'prefix', 'exact'],
              description:
                'Modo de comparação: `fuzzy` (tolerante a typos, padrão), `contains` (substring), `prefix` (começa com), `exact` (igual).',
            },
            limit: {
              type: 'number',
              description: 'Máximo de resultados (1–50, padrão 10).',
            },
          },
          required: [],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const TOOL = 'query_patients';
      const rawInput = String(
        detokenizeArg(context, (args as any).patient_name_or_id) ?? '',
      ).trim();

      const limit = Math.min(
        Math.max(
          typeof args.limit === 'number' ? Math.floor(args.limit) : 10,
          1,
        ),
        50,
      );

      const matchModeRaw =
        typeof args.match_mode === 'string'
          ? args.match_mode.trim().toLowerCase()
          : 'fuzzy';
      const matchMode: 'fuzzy' | 'contains' | 'prefix' | 'exact' =
        matchModeRaw === 'prefix' ||
        matchModeRaw === 'exact' ||
        matchModeRaw === 'contains' ||
        matchModeRaw === 'fuzzy'
          ? (matchModeRaw as 'fuzzy' | 'contains' | 'prefix' | 'exact')
          : 'fuzzy';

      // ── Lookup por UUID → detalhe completo ─────────────────────────────────
      if (rawInput.match(/^[0-9a-f-]{36}$/i)) {
        let patient: any;
        try {
          patient = await patientsService.findOne(rawInput, context.userId);
        } catch {
          return `Paciente com ID "${rawInput}" não encontrado.`;
        }

        const cpfToken = patient.cpf
          ? tokenizePii(context, TOOL, 'cpf', patient.cpf)
          : 'Não informado';
        const phoneToken = patient.phone
          ? tokenizePii(context, TOOL, 'phone', patient.phone)
          : 'Não informado';
        const emailToken = patient.email
          ? tokenizePii(context, TOOL, 'email', patient.email)
          : 'Não informado';
        const birthToken = patient.birthDate
          ? tokenizePii(
              context,
              TOOL,
              'birth_date',
              new Date(patient.birthDate).toLocaleDateString('pt-BR'),
            )
          : null;

        const lines = [
          `*Paciente: ${patient.name}* (id: ${patient.id})`,
          `CPF: ${cpfToken}`,
          `Telefone: ${phoneToken}`,
          `Email: ${emailToken}`,
        ];
        if (birthToken) lines.push(`Nascimento: ${birthToken}`);
        return lines.join('\n');
      }

      // ── Busca por nome ──────────────────────────────────────────────────────
      // Para fuzzy: PatientsService já limita ao banco via ILIKE (candidateLimit
      // = limit * 4). Não precisamos mais puxar 500 entidades em memória.
      const patients = await patientsService.findManyWithSearch(
        rawInput || null,
        matchMode,
        limit,
        context.userId,
      );

      if (!patients.length) {
        if (rawInput) {
          return `Nenhum paciente encontrado: nenhum se parece com "${rawInput}".`;
        }
        return 'Nenhum paciente cadastrado nesta clínica ainda.';
      }

      // Para fuzzy: aplica EntityResolverService
      let filtered: any[];
      if (rawInput && matchMode === 'fuzzy') {
        const resolverResult = entityResolver.resolve<any>({
          query: rawInput,
          candidates: patients,
          getName: (p: any) => String(p.name ?? ''),
          getId: (p: any) => String(p.id),
          candidateThreshold: 0.5,
          maxCandidates: limit,
        });
        if (resolverResult.status === 'resolved' && resolverResult.resolved) {
          // Um único match claro → detalhe completo
          const p = resolverResult.resolved.data;
          const cpfToken = p.cpf
            ? tokenizePii(context, TOOL, 'cpf', p.cpf)
            : 'Não informado';
          const phoneToken = p.phone
            ? tokenizePii(context, TOOL, 'phone', p.phone)
            : 'Não informado';
          const emailToken = p.email
            ? tokenizePii(context, TOOL, 'email', p.email)
            : 'Não informado';
          const birthToken = p.birthDate
            ? tokenizePii(
                context,
                TOOL,
                'birth_date',
                new Date(p.birthDate).toLocaleDateString('pt-BR'),
              )
            : null;
          const lines = [
            `*Paciente: ${p.name}* (id: ${p.id})`,
            `CPF: ${cpfToken}`,
            `Telefone: ${phoneToken}`,
            `Email: ${emailToken}`,
          ];
          if (birthToken) lines.push(`Nascimento: ${birthToken}`);
          return lines.join('\n');
        }
        filtered = resolverResult.candidates.slice(0, limit).map((c) => c.data);
        if (!filtered.length) {
          return `Nenhum paciente encontrado: nenhum se parece com "${rawInput}".`;
        }
      } else {
        filtered = patients.slice(0, limit);
      }

      const slice = filtered.slice(0, limit);
      const lines = slice.map((p: any) => {
        const phoneToken = p.phone
          ? tokenizePii(context, TOOL, 'phone', p.phone)
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

      const header = rawInput
        ? `Pacientes que ${modeLabel} "${rawInput}" (${filtered.length}):`
        : `Pacientes cadastrados (${patients.length}, mostrando ${slice.length}):`;
      return [header, ...lines].join('\n');
    },
  };

  // Tools legacy removidas:
  //  - `create_patient` (2026-05-12): migrada para `patient_draft_*`.
  //  - `get_patient_info` + `list_patients` (2026-05-12, Fase 4.1 do
  //    PLANO-CONSOLIDACAO-TOOLS-IA-VIA-SERVICES-REST): unificadas em
  //    `query_patients` que delega a `PatientsService.findManyWithSearch()`.

  return [queryPatients];
}
