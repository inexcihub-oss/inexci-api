import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';

import { AiTool, ToolContext } from './tool.interface';
import { UserRepository } from '../../../database/repositories/user.repository';
import { DoctorProfileRepository } from '../../../database/repositories/doctor-profile.repository';
import { StorageService } from '../../storage/storage.service';
import { STORAGE_FOLDERS } from '../../../config/storage.config';

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
      if (!context.userId) return 'Acesso negado.';

      // 1) Verifica se o usuário é médico (tem doctor_profile).
      //    `userRepo.findOne` já carrega a relação `doctorProfile`.
      const user = await userRepo.findOne({ id: context.userId });
      if (!user) {
        return 'Não foi possível identificar o usuário no sistema.';
      }

      const doctorProfile = (user as any).doctorProfile;
      if (!doctorProfile?.id) {
        // Colaborador — devolve orientação clara, sem tentar a operação.
        return [
          'A assinatura digital pertence ao médico e SÓ pode ser cadastrada por ele mesmo, pelo próprio WhatsApp dele (ou pelo app).',
          'Como você é colaborador, peça ao médico responsável que envie a imagem da assinatura aqui no WhatsApp dele e me chame para registrar — eu cuido do resto.',
          'Se preferir, ele também pode fazer o upload diretamente no perfil dentro da plataforma web.',
        ].join('\n\n');
      }

      // 2) Médico — precisa ter mídia (imagem) na conversa.
      const inboundMedia = context.inboundMedia || [];
      if (!inboundMedia.length) {
        return 'Não identifiquei nenhuma imagem nesta mensagem. Envie a foto da sua assinatura pelo WhatsApp e me chame de novo para registrar.';
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
        return 'O arquivo enviado não é uma imagem. Envie uma foto/imagem (JPG, PNG, etc.) da sua assinatura.';
      }

      // 3) Preview / confirmação explícita.
      if (!args.confirm) {
        const replacing = doctorProfile.signatureUrl
          ? ' Isso substitui a assinatura cadastrada anteriormente.'
          : '';
        return `Sua assinatura digital será atualizada com a imagem enviada.${replacing} Confirme com "sim" para registrar.`;
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

        await doctorProfileRepo.update(doctorProfile.id, {
          signatureUrl: newPath,
        } as any);

        return [
          'Assinatura digital atualizada com sucesso.',
          'Ela será aplicada automaticamente nos próximos laudos gerados — não precisa anexar de novo a cada SC.',
        ].join('\n');
      } catch (err: any) {
        return `Erro ao registrar a assinatura: ${err?.message || 'erro desconhecido'}`;
      }
    },
  };

  return [uploadDoctorSignature];
}
