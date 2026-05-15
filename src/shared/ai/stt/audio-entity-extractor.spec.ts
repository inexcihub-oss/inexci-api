import { AudioEntityExtractor } from './audio-entity-extractor';

describe('AudioEntityExtractor', () => {
  const ext = new AudioEntityExtractor();

  it('extrai TUSS, CID e SC ref', () => {
    const r = ext.extract(
      'criar SC para Maria com TUSS 30602114 e CID M17.1, SC-0042 já existe',
    );
    expect(r.entities.tuss_hint).toEqual(['30602114']);
    expect(r.entities.cid_hint).toEqual(['M17.1']);
    expect(r.entities.surgery_request_ref).toBe('SC-0042');
  });

  it('extrai data ISO e BR e CRM', () => {
    const r = ext.extract('agendar para 2026-06-10 com CRM-SP 12345');
    expect(r.entities.date_hint).toBe('2026-06-10');
    expect(r.entities.doctor_crm?.toUpperCase()).toContain('CRM');
  });

  it('extrai valor monetário', () => {
    const r = ext.extract('faturamos R$ 1.234,56 hoje');
    expect(r.entities.monetary_values).toEqual([1234.56]);
  });

  it('detecta intent_hint create_sc por keywords', () => {
    const r = ext.extract('quero abrir uma nova sc para o Pedro');
    expect(r.intent_hint).toBe('create_sc');
  });

  it('detecta intent_hint invoice quando há SC ref + faturar', () => {
    const r = ext.extract('faturar a SC-0042');
    expect(r.intent_hint).toBe('invoice');
  });

  it('detecta convenio quando keyword conhecido aparece', () => {
    const r = ext.extract('paciente da unimed pede consulta');
    expect(r.entities.health_plan_alias).toBe('Unimed');
  });

  it('texto vazio devolve entities vazias e intent_hint null', () => {
    const r = ext.extract('');
    expect(r.intent_hint).toBeNull();
    expect(Object.keys(r.entities)).toHaveLength(0);
  });
});
