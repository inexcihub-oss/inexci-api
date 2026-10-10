import OpenAI from 'openai';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AiTool, ToolContext } from './tool.interface';
import { UserRepository } from '../../../database/repositories/user.repository';
import { DoctorProfileRepository } from '../../../database/repositories/doctor-profile.repository';
import { StorageService } from '../../storage/storage.service';
import { STORAGE_FOLDERS } from '../../../config/storage.config';
import { UsersService } from '../../../modules/users/users.service';
import { WhatsappDocumentDispatcherService } from '../services/whatsapp-document-dispatcher.service';
import { ConversationMemoryService } from '../services/orchestrator/conversation-memory.service';
import { translateServiceError } from './helpers/service-error-translator';
import { downloadTwilioInboundMedia } from './helpers/twilio-media-download';
import { buildToolResult } from './tool-result';
import { Permission } from 'src/shared/permissions';

const logger = new Logger('DoctorProfileTools');

async function downloadInboundMedia(
  url: string,
  configService: ConfigService,
): Promise<{ buffer: Buffer; contentType: string | null; fileName: string }> {
  return downloadTwilioInboundMedia(url, configService, 'signature');
}

export interface DoctorProfileToolDeps {
  userRepo: UserRepository;
  doctorProfileRepo: DoctorProfileRepository;
  storageService: StorageService;
  configService: ConfigService;
  usersService: UsersService;
  documentDispatcher: WhatsappDocumentDispatcherService;
  conversationMemory: ConversationMemoryService;
}

async function markAwaitingSignature(
  conversationMemory: ConversationMemoryService,
  conversationId: string,
): Promise<void> {
  if (!conversationId) return;
  try {
    await conversationMemory.setAwaitingMedia(conversationId, 'signature');
  } catch (err) {
    logger.warn(
      `[SIGNATURE] falha ao marcar espera de mídia conv=${conversationId}: ${(err as Error)?.message}`,
    );
  }
}

export function buildDoctorProfileTools(deps: DoctorProfileToolDeps): AiTool[] {
  const {
    userRepo,
    doctorProfileRepo,
    storageService,
    configService,
    usersService,
    documentDispatcher,
    conversationMemory,
  } = deps;
  const uploadDoctorSignature: AiTool = {
    name: 'upload_doctor_signature',
    requiredPermission: [
      Permission.ADMINISTRACAO,
      Permission.SOLICITACOES,
      Permission.ATENDIMENTO,
    ],
    mutates: true,
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

      const doctorProfile = await doctorProfileRepo.findByUserId(
        context.userId,
      );
      if (!doctorProfile?.id) {
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

      const inboundMedia = context.inboundMedia || [];
      const rawIndex = args.mediaIndex;

      type ResolvedMedia =
        | {
            source: 'inbound';
            url: string;
            contentType: string | null;
            index: number;
          }
        | {
            source: 'staging';
            storagePath: string;
            contentType: string;
            index: 0;
          };

      let resolvedMedia: ResolvedMedia | null = null;

      if (inboundMedia.length > 0) {
        const idx =
          typeof rawIndex === 'number' &&
          Number.isInteger(rawIndex) &&
          rawIndex >= 0 &&
          rawIndex < inboundMedia.length
            ? rawIndex
            : 0;
        const m = inboundMedia[idx];
        resolvedMedia = {
          source: 'inbound',
          url: m.url,
          contentType: m.contentType ?? null,
          index: idx,
        };
      } else if (context.phone) {
        const pending = await documentDispatcher.getPending(context.phone);
        if (pending && pending.kind === 'image') {
          resolvedMedia = {
            source: 'staging',
            storagePath: pending.storagePath,
            contentType: pending.contentType,
            index: 0,
          };
        }
      }

      if (!resolvedMedia) {
        await markAwaitingSignature(conversationMemory, context.conversationId);
        return buildToolResult({
          status: 'needs_input',
          message: 'Imagem da assinatura não foi enviada.',
          displayText:
            'Me envie a foto da sua assinatura aqui no WhatsApp e eu registro pra você. Assim que receber, faço o upload e confirmo.',
          nextRequiredFields: ['signature_image'],
        });
      }

      const mime = (resolvedMedia.contentType || '').toLowerCase();
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
              message: `contentType=${resolvedMedia.contentType ?? 'unknown'} não é image/*`,
            },
          ],
        });
      }

      if (!args.confirm) {
        await markAwaitingSignature(conversationMemory, context.conversationId);
        const replacing = doctorProfile.signatureUrl
          ? ' Isso substitui a assinatura cadastrada anteriormente.'
          : '';
        const sourceHint =
          resolvedMedia.source === 'staging'
            ? ' (usando a imagem que você acabou de enviar)'
            : '';
        const previewText = `Sua assinatura digital será atualizada com a imagem enviada${sourceHint}.${replacing} Confirme com "sim" para registrar.`;
        const pendingArgs: Record<string, unknown> = { confirm: true };
        if (
          resolvedMedia.source === 'inbound' &&
          typeof rawIndex === 'number' &&
          Number.isInteger(rawIndex)
        ) {
          pendingArgs.mediaIndex = resolvedMedia.index;
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

      try {
        let newPath: string;
        if (resolvedMedia.source === 'inbound') {
          const downloaded = await downloadInboundMedia(
            resolvedMedia.url,
            configService,
          );
          newPath = await storageService.create(
            {
              originalname: `signature-${doctorProfile.id}.${
                mime.includes('png') ? 'png' : 'jpg'
              }`,
              mimetype:
                resolvedMedia.contentType ||
                downloaded.contentType ||
                'image/png',
              buffer: downloaded.buffer,
            },
            STORAGE_FOLDERS.SIGNATURES,
            context.userId as string,
          );
        } else {
          newPath = await storageService.move(
            resolvedMedia.storagePath,
            STORAGE_FOLDERS.SIGNATURES,
          );
        }

        const oldPath: string | null = doctorProfile.signatureUrl ?? null;

        try {
          await usersService.updateSignatureUrl(context.userId, newPath);
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

        if (oldPath && !oldPath.startsWith('http') && oldPath !== newPath) {
          try {
            await storageService.delete(oldPath);
          } catch (err) {
            logger.warn(
              `[SIGNATURE] assinatura antiga não removida path=${oldPath}: ${(err as Error)?.message}`,
            );
          }
        }

        if (resolvedMedia.source === 'staging') {
          try {
            await documentDispatcher.clearPending(context.phone);
          } catch (err) {
            logger.warn(
              `[SIGNATURE] falha ao limpar staging phone=${context.phone}: ${(err as Error)?.message}`,
            );
          }
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
