import * as sharpModulo from 'sharp';

type SharpFactory = typeof sharpModulo.default;

export const sharp: SharpFactory =
  (sharpModulo as unknown as { default?: SharpFactory }).default ??
  (sharpModulo as unknown as SharpFactory);

export const FOTO_PACIENTE_LADO_MAX = 800;

export const FOTO_PACIENTE_CONTENT_TYPE = 'image/webp';

export const FOTO_PACIENTE_MAX_PIXELS = 40_000_000;

export const FOTO_PACIENTE_FORMATOS = ['jpeg', 'png', 'webp'] as const;

export async function otimizarFotoPaciente(conteudo: Buffer): Promise<Buffer> {
  const imagem = sharp(conteudo, {
    failOn: 'warning',
    limitInputPixels: FOTO_PACIENTE_MAX_PIXELS,
    animated: false,
    pages: 1,
  });
  const { format } = await imagem.metadata();
  if (
    !format ||
    !(FOTO_PACIENTE_FORMATOS as readonly string[]).includes(format)
  ) {
    throw new Error(
      `Formato de foto não suportado: ${format ?? 'desconhecido'}`,
    );
  }
  return imagem
    .rotate()
    .resize({
      width: FOTO_PACIENTE_LADO_MAX,
      height: FOTO_PACIENTE_LADO_MAX,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 80 })
    .toBuffer();
}

const PREFIXO_UUID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-)+/i;

const NOME_BASE_MAX = 100;

export function nomeWebp(nome: string): string {
  const base = nome
    .replace(PREFIXO_UUID, '')
    .replace(/\.[^./\\]+$/, '')
    .slice(0, NOME_BASE_MAX);
  return `${base || 'foto'}.webp`;
}
