import {
  blocosFeegow,
  conteudoDaFicha,
  FormularioFeegow,
  MODELO_RESUMO_IA,
  secoesPorTitulo,
  textoComparavel,
} from './clinical-content.rule';

const quando = new Date('2026-05-14T13:33:00.000Z');

function form(parcial: Partial<FormularioFeegow>): FormularioFeegow {
  return {
    modeloId: '3',
    nomeModelo: 'Anamnese / Evolução (Caixa Livre)',
    quando,
    conteudo: ' : <p>Texto</p>',
    ...parcial,
  };
}

const PRIMEIRA_CONSULTA_IA =
  'Primeira Consulta : <h3>Queixa principal</h3><p>Dor no joelho.</p>' +
  '<h3>Histórico médico</h3><p>HAS.</p>' +
  '<h3>Exame físico</h3><p>Derrame +.</p>' +
  '<h3>Avaliação</h3><p>Lesão meniscal.</p>' +
  '<h3>Plano</h3><ul><li>RM</li></ul>' +
  '<h3>Seção nova</h3><p>Extra.</p>';

describe('blocosFeegow', () => {
  it('separa "Rótulo : valor" por linha em branco e descarta vazios', () => {
    expect(
      blocosFeegow(
        'Queixa Principal : <br>dor\n\nExame Físico : <br>\n\n : <p>livre</p>',
      ),
    ).toEqual([
      { rotulo: 'Queixa Principal', valor: '<br>dor' },
      { rotulo: '', valor: '<p>livre</p>' },
    ]);
  });

  it('linha em branco dentro do valor não corta o bloco', () => {
    expect(blocosFeegow(' : a\n\nb sem rótulo')).toEqual([
      { rotulo: '', valor: 'a\n\nb sem rótulo' },
    ]);
  });
});

describe('secoesPorTitulo', () => {
  it('corta nos <h3> e guarda o que vem antes sem título', () => {
    expect(secoesPorTitulo('<p>intro</p><h3>Plano</h3><p>x</p>')).toEqual([
      { titulo: null, html: '<p>intro</p>' },
      { titulo: 'Plano', html: '<p>x</p>' },
    ]);
  });
});

describe('conteudoDaFicha', () => {
  it('formulário de IA (-4): cada seção vai para o seu campo, com o título', () => {
    const c = conteudoDaFicha(
      [
        form({
          modeloId: '-4',
          nomeModelo: 'Primeira Consulta',
          conteudo: PRIMEIRA_CONSULTA_IA,
        }),
      ],
      'anamnesis',
    );
    expect(c.anamnesis).toBe(
      '<h3>Queixa principal</h3><p>Dor no joelho.</p><h3>Histórico médico</h3><p>HAS.</p><h3>Seção nova</h3><p>Extra.</p>',
    );
    expect(c.physicalExam).toBe('<h3>Exame físico</h3><p>Derrame +.</p>');
    expect(c.diagnosis).toBe('<h3>Avaliação</h3><p>Lesão meniscal.</p>');
    expect(c.conduct).toBe('<h3>Plano</h3><ul><li>RM</li></ul>');
  });

  it('formulário com rótulos (1): rótulo em negrito no campo certo', () => {
    const c = conteudoDaFicha(
      [
        form({
          modeloId: '1',
          nomeModelo: 'Primeira Consulta',
          conteudo:
            'Queixa Principal : dor\n\nExame Físico : edema\n\nConduta : gelo\n\nCampo Novo : algo',
        }),
      ],
      'anamnesis',
    );
    expect(c.anamnesis).toBe(
      '<p><strong>Queixa Principal</strong></p>dor<p><strong>Campo Novo</strong></p>algo',
    );
    expect(c.physicalExam).toBe('<p><strong>Exame Físico</strong></p>edema');
    expect(c.conduct).toBe('<p><strong>Conduta</strong></p>gelo');
  });

  it('caixa livre vai para o campo escolhido (padrão anamnese ou conduta)', () => {
    expect(conteudoDaFicha([form({})], 'anamnesis').anamnesis).toBe(
      '<p>Texto</p>',
    );
    const c = conteudoDaFicha([form({})], 'conduct');
    expect(c.conduct).toBe('<p>Texto</p>');
    expect(c.anamnesis).toBeNull();
  });

  it('modelo "importado" (7): a partir de "cdt:" vai para a conduta', () => {
    const c = conteudoDaFicha(
      [
        form({
          modeloId: '7',
          nomeModelo: 'importado',
          conteudo:
            ' : Dor lombar há 2 meses<br>cdt: fisioterapia<br>retorno 30d',
        }),
      ],
      'anamnesis',
    );
    expect(c.anamnesis).toBe('Dor lombar há 2 meses');
    expect(c.conduct).toBe('cdt: fisioterapia<br />retorno 30d');
  });

  it('dois formulários: blocos em ordem cronológica, cada um com <h4>', () => {
    const depois = new Date(quando.getTime() + 3_600_000);
    const c = conteudoDaFicha(
      [
        form({ quando: depois, conteudo: ' : <p>segundo</p>' }),
        form({
          modeloId: '9',
          nomeModelo: 'Anamnese geriatria',
          conteudo: 'Novo Texto : <p>primeiro</p>',
        }),
      ],
      'anamnesis',
    );
    expect(c.anamnesis).toBe(
      '<h4>Anamnese geriatria — 14/05/2026 10:33</h4><p>primeiro</p>' +
        '<h4>Anamnese / Evolução (Caixa Livre) — 14/05/2026 11:33</h4><p>segundo</p>',
    );
  });

  it('rascunho ganha cabeçalho mesmo sozinho', () => {
    const c = conteudoDaFicha([form({ rascunho: true })], 'anamnesis');
    expect(c.anamnesis).toContain('(rascunho no Feegow)</h4>');
  });

  it('script, style, atributos e &nbsp; saem; nomes do Feegow são escapados', () => {
    const c = conteudoDaFicha(
      [
        form({
          quando,
          conteudo: ' : <p onclick="x()">a&nbsp;b</p><script>alert(1)</script>',
        }),
        form({ nomeModelo: '<img src=x onerror=alert(1)>', conteudo: ' : c' }),
      ],
      'anamnesis',
    );
    expect(c.anamnesis).not.toMatch(/<script|onclick|<img/);
    expect(c.anamnesis).toContain('<p>a b</p>');
    expect(c.anamnesis).toContain('&lt;img');
  });

  it('formulário sem texto não gera campo', () => {
    expect(
      conteudoDaFicha(
        [form({ conteudo: ' : <br>\n\nX : &nbsp;' })],
        'anamnesis',
      ),
    ).toEqual({
      anamnesis: null,
      physicalExam: null,
      diagnosis: null,
      conduct: null,
    });
  });

  it('resumo de IA usa o mesmo mapeamento por seção', () => {
    const c = conteudoDaFicha(
      [
        form({
          modeloId: MODELO_RESUMO_IA,
          nomeModelo: 'Resumo',
          conteudo: '<h3>Plano</h3><p>x</p>',
        }),
      ],
      'anamnesis',
    );
    expect(c.conduct).toBe('<h3>Plano</h3><p>x</p>');
  });
});

describe('textoComparavel', () => {
  it('ignora rótulo, tags, entidades e caixa', () => {
    expect(
      textoComparavel('Primeira Consulta : <h3>Plano</h3><p>Gelo&nbsp;já</p>'),
    ).toBe(textoComparavel('<h3>plano</h3> gelo ja'));
  });
});
