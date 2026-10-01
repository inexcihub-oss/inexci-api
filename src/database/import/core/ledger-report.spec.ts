import { mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Ledger } from './ledger';
import { Relatorio } from './report';

describe('Ledger', () => {
  it('registra, resolve e salva em arquivo', () => {
    const caminho = join(mkdtempSync(join(tmpdir(), 'ledger-')), 'l.json');
    const ledger = new Ledger(caminho);
    ledger.registrar('patient', '10', 'uuid-10');

    expect(ledger.resolver('patient', '10')).toBe('uuid-10');
    expect(ledger.resolver('patient', '11')).toBeNull();
    expect(ledger.resolver('patient', null)).toBeNull();

    ledger.salvar();
    expect(JSON.parse(readFileSync(caminho, 'utf-8'))).toEqual({
      patient: { '10': 'uuid-10' },
    });
    expect(new Ledger(caminho).resolver('patient', '10')).toBe('uuid-10');
  });

  it('clonar não deixa o planejamento sujar o original', () => {
    const ledger = new Ledger(null);
    const copia = ledger.clonar();
    copia.registrar('patient', '1', 'x');

    expect(ledger.total('patient')).toBe(0);
    expect(copia.total('patient')).toBe(1);
  });

  it('sem caminho, salvar não faz nada (dry-run)', () => {
    expect(() => new Ledger(null).salvar()).not.toThrow();
  });
});

describe('Relatorio', () => {
  it('agrupa rejeições por motivo no resumo', () => {
    const r = new Relatorio('cadastro');
    r.aceitar('patient', 2);
    r.rejeitar('appointment', '1', 'sem paciente');
    r.rejeitar('appointment', '2', 'sem paciente');
    r.avisar('patient', '3', 'CPF inválido descartado');

    const resumo = r.resumo();
    expect(resumo).toContain('patient: 2 a gravar');
    expect(resumo).toContain('2 × appointment — sem paciente');
    expect(resumo).toContain('1 × patient — CPF inválido descartado');
  });
});
