import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Ledger } from './ledger';
import { Relatorio } from './report';

const VINCULO = { ownerId: 'dono-1', banco: 'inexci' };

describe('Ledger', () => {
  it('registra, resolve e salva em arquivo', () => {
    const caminho = join(mkdtempSync(join(tmpdir(), 'ledger-')), 'l.json');
    const ledger = new Ledger(caminho);
    ledger.registrar('patient', '10', 'uuid-10');

    expect(ledger.resolver('patient', '10')).toBe('uuid-10');
    expect(ledger.resolver('patient', '11')).toBeNull();
    expect(ledger.resolver('patient', null)).toBeNull();

    ledger.vincular(VINCULO);
    ledger.salvar();
    expect(JSON.parse(readFileSync(caminho, 'utf-8'))).toEqual({
      versao: 2,
      vinculo: VINCULO,
      registros: { patient: { '10': 'uuid-10' } },
    });
    const relido = new Ledger(caminho);
    expect(relido.resolver('patient', '10')).toBe('uuid-10');
    expect(relido.vinculo).toEqual(VINCULO);
  });

  it('salvar é atômico: não deixa temporário e não salva sem vínculo', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'ledger-'));
    const caminho = join(pasta, 'l.json');
    const ledger = new Ledger(caminho);
    ledger.registrar('patient', '1', 'u1');
    expect(() => ledger.salvar()).toThrow(/vincular/);
    expect(existsSync(caminho)).toBe(false);

    ledger.vincular(VINCULO);
    ledger.salvar();
    expect(readdirSync(pasta)).toEqual(['l.json']);
  });

  describe('vincular', () => {
    const novo = () =>
      join(mkdtempSync(join(tmpdir(), 'ledger-')), 'ledger.json');

    it('ledger novo adota a conta/banco da execução', () => {
      const ledger = new Ledger(novo());
      ledger.vincular(VINCULO);
      expect(ledger.vinculo).toEqual(VINCULO);
    });

    it('ledger de outra conta ou outro banco aborta', () => {
      const caminho = novo();
      const ledger = new Ledger(caminho);
      ledger.vincular(VINCULO);
      ledger.registrar('patient', '1', 'u1');
      ledger.salvar();

      expect(() =>
        new Ledger(caminho).vincular({ ...VINCULO, ownerId: 'outro-dono' }),
      ).toThrow(/outra carga.*dono/);
      expect(() =>
        new Ledger(caminho).vincular({ ...VINCULO, banco: 'inexci_homolog' }),
      ).toThrow(/outra carga.*banco/);
      expect(() =>
        new Ledger(caminho).vincular(
          { ...VINCULO, ownerId: 'outro-dono' },
          { adotar: true },
        ),
      ).toThrow(/outra carga/);
      expect(() => new Ledger(caminho).vincular(VINCULO)).not.toThrow();
    });

    it('ledger antigo (sem vínculo) com registros exige --adotar-ledger', () => {
      const caminho = novo();
      writeFileSync(caminho, JSON.stringify({ patient: { '1': 'u1' } }));

      expect(() => new Ledger(caminho).vincular(VINCULO)).toThrow(
        /--adotar-ledger/,
      );

      const adotado = new Ledger(caminho);
      expect(adotado.resolver('patient', '1')).toBe('u1');
      adotado.vincular(VINCULO, { adotar: true });
      adotado.salvar();
      expect(new Ledger(caminho).vinculo).toEqual(VINCULO);
    });

    it('clonar leva o vínculo junto', () => {
      const ledger = new Ledger(null);
      ledger.vincular(VINCULO);
      expect(ledger.clonar().vinculo).toEqual(VINCULO);
    });
  });

  it('removerPorUuid desfaz o registro e devolve o id de origem', () => {
    const ledger = new Ledger(null);
    ledger.registrar('document', '7', 'doc-7');
    expect(ledger.removerPorUuid('document', 'doc-7')).toBe('7');
    expect(ledger.resolver('document', '7')).toBeNull();
    expect(ledger.removerPorUuid('document', 'doc-7')).toBeNull();
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

  it('rejeitarAceito tira da contagem e registra a rejeição', () => {
    const r = new Relatorio('anexos');
    r.aceitar('foto', 2);
    r.rejeitarAceito('foto', '9', 'arquivo ilegível');
    r.desfazerAceite('foto');
    expect(r.aceitos.foto).toBe(0);
    expect(r.rejeicoes).toEqual([
      { entidade: 'foto', idOrigem: '9', motivo: 'arquivo ilegível' },
    ]);
  });
});
