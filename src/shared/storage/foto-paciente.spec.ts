import {
  FOTO_PACIENTE_LADO_MAX,
  FOTO_PACIENTE_MAX_PIXELS,
  nomeWebp,
  otimizarFotoPaciente,
  sharp,
} from './foto-paciente';

async function imagem(width: number, height: number, formato: 'png' | 'jpeg') {
  const base = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 120, b: 40 },
    },
  });
  return (formato === 'png' ? base.png() : base.jpeg()).toBuffer();
}

describe('otimizarFotoPaciente', () => {
  it('converte para WebP e reduz o maior lado a 800 px', async () => {
    const saida = await otimizarFotoPaciente(await imagem(2400, 1200, 'jpeg'));
    const meta = await sharp(saida).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(FOTO_PACIENTE_LADO_MAX);
    expect(meta.height).toBe(400);
  });

  it('não amplia foto pequena (640×480 do Feegow fica do mesmo tamanho)', async () => {
    const saida = await otimizarFotoPaciente(await imagem(640, 480, 'png'));
    const meta = await sharp(saida).metadata();
    expect([meta.width, meta.height]).toEqual([640, 480]);
  });

  it('fica bem menor que o PNG original', async () => {
    // Degradê com textura leve: mais parecido com uma foto que uma cor lisa
    // (que qualquer formato comprime) ou ruído puro (que nenhum comprime).
    const raw = Buffer.alloc(640 * 480 * 3);
    for (let y = 0; y < 480; y++) {
      for (let x = 0; x < 640; x++) {
        const i = (y * 640 + x) * 3;
        raw[i] = (x * 255) / 640 + ((x * y) % 7);
        raw[i + 1] = (y * 255) / 480 + ((x + y) % 5);
        raw[i + 2] = ((x + y) * 255) / 1120;
      }
    }
    const png = await sharp(raw, {
      raw: { width: 640, height: 480, channels: 3 },
    })
      .png()
      .toBuffer();
    const saida = await otimizarFotoPaciente(png);
    expect(saida.length).toBeLessThan(png.length / 3);
  });

  it('recusa arquivo que não é imagem', async () => {
    await expect(
      otimizarFotoPaciente(Buffer.from('não é imagem')),
    ).rejects.toThrow();
  });

  it('recusa imagem acima do teto de pixels (bomba de descompressão)', async () => {
    // 6500×6500 = 42,25 Mpx: um PNG liso de poucos KB que, decodificado,
    // ocuparia ~127 MB. O sharp recusa pelo cabeçalho, antes do decode.
    expect(6500 * 6500).toBeGreaterThan(FOTO_PACIENTE_MAX_PIXELS);
    const enorme = await imagem(6500, 6500, 'png');
    await expect(otimizarFotoPaciente(enorme)).rejects.toThrow(/pixel limit/i);
  });

  it('recusa SVG mesmo sendo uma imagem válida para o sharp', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    await expect(otimizarFotoPaciente(svg)).rejects.toThrow(
      'Formato de foto não suportado: svg',
    );
  });

  it('recusa GIF (fora dos formatos de foto)', async () => {
    const gif = await sharp({
      create: { width: 10, height: 10, channels: 3, background: '#000' },
    })
      .gif()
      .toBuffer();
    await expect(otimizarFotoPaciente(gif)).rejects.toThrow(/gif/);
  });

  it('recusa JPEG truncado (failOn warning)', async () => {
    const jpeg = await imagem(640, 480, 'jpeg');
    const truncado = jpeg.subarray(0, Math.floor(jpeg.length / 2));
    await expect(otimizarFotoPaciente(truncado)).rejects.toThrow();
  });

  it('nomeWebp troca só a extensão', () => {
    expect(nomeWebp('abc.png')).toBe('abc.webp');
    expect(nomeWebp('foto.da.ana.JPG')).toBe('foto.da.ana.webp');
    expect(nomeWebp('sem-extensao')).toBe('sem-extensao.webp');
  });

  it('nomeWebp tira o prefixo uuid de uploads anteriores (sem crescer a cada reconversão)', () => {
    const uuid = '3f2b8c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
    expect(nomeWebp(`${uuid}-foto.png`)).toBe('foto.webp');
    expect(nomeWebp(`${uuid}-${uuid}-foto.png`)).toBe('foto.webp');
    expect(nomeWebp(`${uuid}-.png`)).toBe('foto.webp');
  });

  it('nomeWebp corta nome muito longo (caminho cabe em varchar 255)', () => {
    const nome = nomeWebp(`${'a'.repeat(400)}.png`);
    expect(nome).toBe(`${'a'.repeat(100)}.webp`);
  });
});
