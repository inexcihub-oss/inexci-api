import { calcularEscalaSegura, MAX_PIXELS_POR_PAGINA } from './ocr.service';

describe('Rasterizacao de PDF — teto de pixels', () => {
  it('reduz a escala em pagina gigante', () => {
    // MediaBox maximo do formato PDF: 14400x14400 pt.
    const escala = calcularEscalaSegura(14400, 14400);
    expect(14400 * escala * (14400 * escala)).toBeLessThanOrEqual(
      MAX_PIXELS_POR_PAGINA,
    );
    expect(escala).toBeLessThan(2);
  });

  it('mantem escala 2 em pagina A4 normal', () => {
    expect(calcularEscalaSegura(595, 842)).toBe(2);
  });
});
