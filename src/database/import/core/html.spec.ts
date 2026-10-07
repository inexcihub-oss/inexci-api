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

describe('blocos descartados não colam o texto', () => {
  const tabela =
    '<table><tr><td>Dipirona</td><td>500mg</td></tr><tr><td>Ibuprofeno</td><td>600mg</td></tr></table>';

  it('sanitizarHtmlClinico: célula vira " | " e linha vira <br>', () => {
    expect(sanitizarHtmlClinico(tabela)).toBe(
      'Dipirona | 500mg<br />Ibuprofeno | 600mg',
    );
  });

  it('sanitizarHtmlClinico: div quebra a linha, sem linha em branco entre divs', () => {
    expect(
      sanitizarHtmlClinico('<div>A</div><div>B</div>Texto<div>C</div>'),
    ).toBe('A<br />B<br />Texto<br />C');
  });

  it('htmlParaTexto: tabela e div viram linhas', () => {
    expect(htmlParaTexto(tabela)).toBe('Dipirona | 500mg\nIbuprofeno | 600mg');
    expect(htmlParaTexto('<div>A</div><div>B</div>')).toBe('A\nB');
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
