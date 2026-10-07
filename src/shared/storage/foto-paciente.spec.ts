import {
  FOTO_PACIENTE_LADO_MAX,
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

  it('nomeWebp troca só a extensão', () => {
    expect(nomeWebp('abc.png')).toBe('abc.webp');
    expect(nomeWebp('foto.da.ana.JPG')).toBe('foto.da.ana.webp');
    expect(nomeWebp('sem-extensao')).toBe('sem-extensao.webp');
  });
});
