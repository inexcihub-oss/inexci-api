import * as sharpModulo from 'sharp';

type SharpFactory = typeof sharpModulo.default;

/**
 * O pacote expõe a função como export padrão (ESM) e como o próprio módulo
 * (CJS, que é como o Nest compila). Aceita as duas formas.
 */
export const sharp: SharpFactory =
  (sharpModulo as unknown as { default?: SharpFactory }).default ??
  (sharpModulo as unknown as SharpFactory);

/**
 * Maior lado da foto de paciente guardada. Uma versão só serve a miniatura
 * (32–80 px na tela) e a foto ampliada ao clicar; as fotos do Feegow têm
 * 640×480 e ficam no tamanho original, só recomprimidas.
 */
export const FOTO_PACIENTE_LADO_MAX = 800;

export const FOTO_PACIENTE_CONTENT_TYPE = 'image/webp';

/**
 * Foto de paciente → WebP de no máximo 800 px, qualidade 80. Um PNG de
 * 500 KB vira algo em torno de 30–60 KB. `rotate()` aplica a orientação do
 * EXIF (foto de celular deitada) antes de descartar os metadados — que também
 * levam localização e modelo do aparelho, dado que não precisamos guardar.
 */
export async function otimizarFotoPaciente(conteudo: Buffer): Promise<Buffer> {
  return sharp(conteudo, { failOn: 'error' })
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

/** `foto.png` → `foto.webp`. */
export function nomeWebp(nome: string): string {
  return `${nome.replace(/\.[^./\\]+$/, '')}.webp`;
}
