import { applyGlossary } from './stt-glossary';

describe('applyGlossary', () => {
  it('substitui TLD orais por canônica', () => {
    expect(applyGlossary('joao arroba teste ponto com br')).toContain('.com.br');
  });

  it('canoniza siglas médicas', () => {
    expect(applyGlossary('codigo tu ess oito digitos').toUpperCase()).toContain(
      'TUSS',
    );
    expect(applyGlossary('see ide cee r m').toUpperCase()).toContain('CID');
    expect(applyGlossary('see ide cee r m').toUpperCase()).toContain('CRM');
  });

  it('canoniza nomes de hospital comuns', () => {
    expect(applyGlossary('cirurgia no são lucas amanha')).toContain(
      'Hospital São Lucas',
    );
    expect(applyGlossary('vou no einstein')).toContain(
      'Hospital Israelita Albert Einstein',
    );
  });

  it('é idempotente', () => {
    const a = applyGlossary('arroba');
    const b = applyGlossary(a);
    expect(b).toBe(a);
  });

  it('preserva texto sem matches', () => {
    expect(applyGlossary('nada para mudar aqui')).toBe(
      'nada para mudar aqui',
    );
  });
});
