import { htmlParaTexto, htmlSemTexto, sanitizarHtmlClinico } from './html';

describe('sanitizarHtmlClinico', () => {
  it('remove script, style, atributos e tags fora da allowlist', () => {
    expect(
      sanitizarHtmlClinico(
        '<p style="color:red" onclick="x()">Dor <font color="red">forte</font></p><script>alert(1)</script><style>p{}</style>',
      ),
    ).toBe('<p>Dor forte</p>');
  });

  it('&nbsp; vira espaço, quebra crua vira <br> e pontas vazias saem', () => {
    expect(sanitizarHtmlClinico('<br>linha&nbsp;1\nlinha 2<br><br>')).toBe(
      'linha 1<br />linha 2',
    );
  });

  it('parágrafos vazios e excesso de quebras são limpos', () => {
    expect(sanitizarHtmlClinico('<p> </p><p>a</p><br><br><br><br>b')).toBe(
      '<p>a</p><br /><br />b',
    );
  });

  it('mantém listas e títulos', () => {
    expect(sanitizarHtmlClinico('<h3>Plano</h3><ul><li>Gelo</li></ul>')).toBe(
      '<h3>Plano</h3><ul><li>Gelo</li></ul>',
    );
  });
});

describe('htmlSemTexto', () => {
  it('só tags, espaços e &nbsp; contam como vazio', () => {
    expect(htmlSemTexto('<br>\n\n<p>&nbsp;</p>')).toBe(true);
    expect(htmlSemTexto('<p>ok</p>')).toBe(false);
    expect(htmlSemTexto(null)).toBe(true);
  });
});

describe('htmlParaTexto', () => {
  it('quebras de bloco viram linhas e entidades são decodificadas', () => {
    expect(
      htmlParaTexto(
        '<p>Atesto que [Paciente.Nome]&nbsp;esteve</p><p>em consulta &amp; exame.</p><ul><li>A</li></ul>',
      ),
    ).toBe('Atesto que [Paciente.Nome] esteve\nem consulta & exame.\n- A');
  });

  it('script some com o conteúdo', () => {
    expect(htmlParaTexto('a<script>x()</script>b')).toBe('ab');
  });
});
