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
 * Teto de pixels da imagem de ENTRADA (largura × altura), checado pelo sharp
 * antes de decodificar. O padrão do sharp (~268 Mpx) deixa um PNG de 2 MB
 * de 16000×16000 virar centenas de MB de memória no decode — uma "bomba" de
 * descompressão que derruba a API. 40 Mpx cobre com folga as fotos de
 * celular nos modos padrão (12–24 Mpx) e os 640×480 do Feegow; uma foto de
 * 48–50 Mpx de verdade nem passa no limite de 2 MB do upload. No pior caso
 * aceito, o decode fica em ~160 MB (RGBA), e o resultado vai a 800 px.
 */
export const FOTO_PACIENTE_MAX_PIXELS = 40_000_000;

/**
 * Formatos de entrada aceitos, conferidos pelo próprio decoder do sharp (não
 * pela extensão nem pelo MIME declarado). Fora daqui ficam SVG (que o sharp
 * rasteriza via librsvg — superfície de ataque sem nenhum uso numa foto),
 * GIF animado, TIFF, HEIF etc.
 */
export const FOTO_PACIENTE_FORMATOS = ['jpeg', 'png', 'webp'] as const;

/**
 * Foto de paciente → WebP de no máximo 800 px, qualidade 80. Um PNG de
 * 500 KB vira algo em torno de 30–60 KB. `rotate()` aplica a orientação do
 * EXIF (foto de celular deitada) antes de descartar os metadados — que também
 * levam localização e modelo do aparelho, dado que não precisamos guardar.
 *
 * Lança erro para formato fora de `FOTO_PACIENTE_FORMATOS`, imagem acima de
 * `FOTO_PACIENTE_MAX_PIXELS` e arquivo truncado/corrompido (`failOn:
 * 'warning'`, o padrão do sharp: um JPEG cortado no meio não vira foto
 * meio cinza). Quem chama decide como apresentar o erro.
 */
export async function otimizarFotoPaciente(conteudo: Buffer): Promise<Buffer> {
  const imagem = sharp(conteudo, {
    failOn: 'warning',
    limitInputPixels: FOTO_PACIENTE_MAX_PIXELS,
    // Só o primeiro quadro: WebP/PNG animado não vira animação de N quadros
    // decodificados de uma vez.
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

/** Prefixo `<uuid>-` que o `StorageService` põe na frente de todo arquivo. */
const PREFIXO_UUID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-)+/i;

/**
 * Teto do nome-base (sem extensão). O caminho final é
 * `patient-photos/<ownerId>/<uuid>-<nome>` e cabe em `photo_path`
 * (varchar 255): 15 + 36 + 1 + 37 = 89 caracteres fixos, sobram 166.
 */
const NOME_BASE_MAX = 100;

/**
 * `foto.png` → `foto.webp`. Tira o `<uuid>-` de um upload anterior (senão
 * cada reconversão empilharia mais um uuid no nome) e corta nomes longos,
 * para o caminho nunca estourar a coluna.
 */
export function nomeWebp(nome: string): string {
  const base = nome
    .replace(PREFIXO_UUID, '')
    .replace(/\.[^./\\]+$/, '')
    .slice(0, NOME_BASE_MAX);
  return `${base || 'foto'}.webp`;
}
