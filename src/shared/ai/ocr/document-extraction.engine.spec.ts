import { DocumentExtractionEngine } from './document-extraction.engine';

describe('DocumentExtractionEngine', () => {
  const engine = new DocumentExtractionEngine();

  it('texto vazio → ask_user/vision_fallback e confidence baixa', () => {
    const r = engine.extract({ text: '' });
    expect(r.fields).toHaveLength(0);
    expect(r.global_confidence).toBe(0);
    expect(['ask_user', 'vision_fallback']).toContain(r.recommendation);
  });

  it('guia com CPF + TUSS + CID + datas → accept', () => {
    const text = `
      GUIA SP/SADT
      Paciente: Maria Silva
      CPF 111.444.777-35
      TUSS 30602114 — Artroplastia de quadril
      CID M17.1
      Data autorização: 10/06/2026
      Hospital São Lucas
      CRM-SP 12345
      Valor R$ 5.000,00
    `;
    const r = engine.extract({
      text,
      tussIsValid: () => true,
      cidIsValid: () => true,
    });
    expect(r.recommendation).toBe('accept');
    expect(r.global_confidence).toBeGreaterThanOrEqual(0.85);
    expect(r.fields.some((f) => f.field === 'cpf')).toBe(true);
    expect(r.fields.some((f) => f.field === 'tuss_code')).toBe(true);
    expect(r.fields.some((f) => f.field === 'cid_code')).toBe(true);
    expect(r.fields.some((f) => f.field === 'date')).toBe(true);
  });

  it('texto com extração mista → cheap_llm', () => {
    const text = 'Paciente CPF 123.456.789-00 e TUSS 99999999';
    const r = engine.extract({ text });
    expect(['cheap_llm', 'vision_fallback']).toContain(r.recommendation);
    expect(r.global_confidence).toBeLessThan(0.85);
  });
});
