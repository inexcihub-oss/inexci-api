import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';

import { AiTool, ToolContext } from './tool.interface';
import { UserRepository } from '../../../database/repositories/user.repository';
import { DoctorProfileRepository } from '../../../database/repositories/doctor-profile.repository';
import { StorageService } from '../../storage/storage.service';
import { STORAGE_FOLDERS } from '../../../config/storage.config';
import { UsersService } from '../../../modules/users/users.service';
import { translateServiceError } from './helpers/service-error-translator';
import { buildToolResult } from './tool-result';

/**
 * Baixa uma mídia inbound do WhatsApp (Twilio) usando autenticação básica
 * com as credenciais da conta. Mesma estratégia usada por `manage_documents`
 * e `manage_report_images` em `manage.tools.ts`.
 */
async function downloadInboundMedia(
  url: string,
  configService?: ConfigService,
): Promise<{ buffer: Buffer; contentType: string | null; fileName: string }> {
  const sid = configService?.get<string>('TWILIO_ACCOUNT_SID', '') || '';
  const token = configService?.get<string>('TWILIO_AUTH_TOKEN', '') || '';

  const headers: Record<string, string> = {};
  if (sid && token) {
    headers.Authorization = `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`falha no download da mídia (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get('content-type');
  const urlPath = new URL(url).pathname;
  const fileNameFallback =
    urlPath.split('/').pop() || `signature-${Date.now()}`;

  return {
    buffer: Buffer.from(arrayBuffer),
    contentType,
    fileName: fileNameFallback,
  };
}

export function buildDoctorProfileTools(
  userRepo: UserRepository,
  doctorProfileRepo: DoctorProfileRepository,
  storageService: StorageService,
  configService: ConfigService,
  usersService?: UsersService,
): AiTool[] {
  // ────────────────────────────────────────────────────────────────────────
  // upload_doctor_signature
  //
  // Atualiza a assinatura digital do médico (campo
  // `doctor_profiles.signature_url`) a partir de uma imagem enviada na
  // mesma conversa do WhatsApp.
  //
  // Regra de negócio crítica: APENAS o próprio médico pode subir a sua
  // assinatura. Se o usuário não tiver `doctor_profile` (é colaborador),
  // a tool RECUSA a operação e devolve uma orientação para o colaborador
  // pedir ao médico que faça o upload pelo WhatsApp dele (ou pelo app).
  //
  // Não escrevemos a assinatura do médico A a partir do WhatsApp do
  // colaborador B mesmo que B tenha acesso ao médico A — é informação
  // pessoal do médico e exige ação dele.
  //
  // Migrada para o envelope canônico `ToolResult` na Fase 4 do
  // `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`: era a única tool ainda no
  // `PREVIEWABLE_MUTATION_TOOLS` e por isso forçava o orchestrator a
  // manter heurísticas de string (`looksLikeConfirmationPreview` /
  // `looksLikeExecutedMutation`). Agora segue o mesmo padrão das tools
  // `*_draft_preview` / `*_draft_commit`.
  // ────────────────────────────────────────────────────────────────────────
  const uploadDoctorSignature: AiTool = {
    name: 'upload_doctor_signature',
    definition: {
      type: 'function',
      function: {
        name: 'upload_doctor_signature',
        description:
          'Sobe a assinatura digital do médico a partir de uma imagem enviada pelo WhatsApp. Só funciona para usuários que SÃO médicos (têm doctor_profile). Para colaboradores, devolve uma mensagem orientando a falar com o médico para que ele mesmo faça o upload. Substitui a assinatura anterior. Requer confirm=true.',
        parameters: {
          type: 'object',
          properties: {
            mediaIndex: {
              type: 'number',
              description:
                'Índice da mídia recebida no WhatsApp quando há mais de uma (opcional; padrão 0).',
            },
            confirm: {
              type: 'boolean',
              description:
                'Se true, executa a substituição. Caso contrário, mostra apenas o preview.',
            },
          },
          required: [],
        },
      },
    } as OpenAI.ChatCompletionTool,

    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) {
        return buildToolResult({
          status: 'blocked',
          message: 'Acesso negado.',
          displayText: 'Acesso negado.',
        });
      }

      // 1) Verifica se o usuário é médico (tem doctor_profile).
      //    `userRepo.findOne` já carrega a relação `doctorProfile`.
      const user = await userRepo.findOne({ id: context.userId });
      if (!user) {
        return buildToolResult({
          status: 'error',
          message: 'Usuário não identificado no sistema.',
          displayText: 'Não foi possível identificar o usuário no sistema.',
          errors: [
            {
              code: 'USER_NOT_FOUND',
              message: 'context.userId não corresponde a um usuário válido.',
            },
          ],
        });
      }

      const doctorProfile = (user as any).doctorProfile;
      if (!doctorProfile?.id) {
        // Colaborador — devolve orientação clara, sem tentar a operação.
        const collaboratorText = [
          'A assinatura digital pertence ao médico e SÓ pode ser cadastrada por ele mesmo, pelo próprio WhatsApp dele (ou pelo app).',
          'Como você é colaborador, peça ao médico responsável que envie a imagem da assinatura aqui no WhatsApp dele e me chame para registrar — eu cuido do resto.',
          'Se preferir, ele também pode fazer o upload diretamente no perfil dentro da plataforma web.',
        ].join('\n\n');
        return buildToolResult({
          status: 'blocked',
          message:
            'Apenas o próprio médico pode cadastrar a assinatura digital.',
          displayText: collaboratorText,
        });
      }

      // 2) Médico — precisa ter mídia (imagem) na conversa.
      const inboundMedia = context.inboundMedia || [];
      if (!inboundMedia.length) {
        return buildToolResult({
          status: 'needs_input',
          message: 'Imagem da assinatura não foi enviada.',
          displayText:
            'Não identifiquei nenhuma imagem nesta mensagem. Envie a foto da sua assinatura pelo WhatsApp e me chame de novo para registrar.',
          nextRequiredFields: ['signature_image'],
        });
      }

      const rawIndex = args.mediaIndex;
      const mediaIndex =
        typeof rawIndex === 'number' &&
        Number.isInteger(rawIndex) &&
        rawIndex >= 0 &&
        rawIndex < inboundMedia.length
          ? rawIndex
          : 0;

      const media = inboundMedia[mediaIndex];
      const mime = (media.contentType || '').toLowerCase();
      if (!mime.startsWith('image/')) {
        return buildToolResult({
          status: 'blocked',
          message: 'O arquivo enviado não é uma imagem.',
          displayText:
            'O arquivo enviado não é uma imagem. Envie uma foto/imagem (JPG, PNG, etc.) da sua assinatura.',
          errors: [
            {
              field: 'inboundMedia',
              code: 'INVALID_MEDIA_TYPE',
              message: `contentType=${media.contentType ?? 'unknown'} não é image/*`,
            },
          ],
        });
      }

      // 3) Preview / confirmação explícita.
      if (!args.confirm) {
        const replacing = doctorProfile.signatureUrl
          ? ' Isso substitui a assinatura cadastrada anteriormente.'
          : '';
        const previewText = `Sua assinatura digital será atualizada com a imagem enviada.${replacing} Confirme com "sim" para registrar.`;
        const pendingArgs: Record<string, unknown> = { confirm: true };
        if (typeof rawIndex === 'number' && Number.isInteger(rawIndex)) {
          pendingArgs.mediaIndex = mediaIndex;
        }
        return buildToolResult({
          status: 'pending_confirmation',
          message:
            'Aguardando confirmação do usuário para atualizar a assinatura.',
          displayText: previewText,
          pendingConfirmation: {
            tool: 'upload_doctor_signature',
            args: pendingArgs,
            description: 'atualizar sua assinatura digital',
          },
        });
      }

      // 4) Faz o upload e atualiza o doctor_profile.
      try {
        const downloaded = await downloadInboundMedia(media.url, configService);
        const newPath = await storageService.create(
          {
            originalname: `signature-${doctorProfile.id}.${
              mime.includes('png') ? 'png' : 'jpg'
            }`,
            mimetype:
              media.contentType || downloaded.contentType || 'image/png',
            buffer: downloaded.buffer,
          } as any,
          STORAGE_FOLDERS.SIGNATURES,
        );

        // 5) Apaga a assinatura anterior (best-effort) — só se for um path
        //    interno do storage (não uma URL externa) e diferente da nova.
        const oldPath: string | null = doctorProfile.signatureUrl ?? null;
        if (oldPath && !oldPath.startsWith('http') && oldPath !== newPath) {
          try {
            await storageService.delete(oldPath);
          } catch {
            // best-effort: se a remoção falhar, mantemos o novo registro mesmo assim.
          }
        }

        try {
          if (usersService) {
            await usersService.updateSignatureUrl(context.userId, newPath);
          } else {
            await doctorProfileRepo.update(doctorProfile.id, {
              signatureUrl: newPath,
            } as any);
          }
        } catch (err) {
          return buildToolResult({
            status: 'error',
            message: 'Erro ao registrar a assinatura.',
            displayText: `Erro ao registrar a assinatura: ${translateServiceError(err)}`,
            errors: [
              {
                code: 'SIGNATURE_PERSIST_FAILED',
                message: translateServiceError(err),
              },
            ],
          });
        }

        const successText = [
          'Assinatura digital atualizada com sucesso.',
          'Ela será aplicada automaticamente nos próximos laudos gerados — não precisa anexar de novo a cada SC.',
        ].join('\n');
        return buildToolResult({
          status: 'ok',
          message: 'Assinatura digital atualizada com sucesso.',
          displayText: successText,
          data: { signatureUrl: newPath },
        });
      } catch (err: any) {
        const reason = err?.message || 'erro desconhecido';
        return buildToolResult({
          status: 'error',
          message: 'Erro ao registrar a assinatura.',
          displayText: `Erro ao registrar a assinatura: ${reason}`,
          errors: [{ code: 'SIGNATURE_UPLOAD_FAILED', message: reason }],
        });
      }
    },
  };

  return [uploadDoctorSignature];
}
