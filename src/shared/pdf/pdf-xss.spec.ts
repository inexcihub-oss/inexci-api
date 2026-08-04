import { sanitizarConteudoDeSecao } from '../../modules/surgery-requests/utils/clinical-report-sections.util';

describe('Secoes de laudo — sanitizacao', () => {
  it('remove script', () => {
    expect(sanitizarConteudoDeSecao('<script>alert(1)</script>')).not.toContain(
      '<script',
    );
  });

  it('remove iframe usado para SSRF no renderizador', () => {
    const malicioso = "<iframe src='http://169.254.169.254/'></iframe>";
    expect(sanitizarConteudoDeSecao(malicioso)).not.toContain('<iframe');
  });

  it('remove o bypass de raw-text via xmp', () => {
    const bypass = '<xmp><img src=x onerror=alert(1)></xmp>';
    const limpo = sanitizarConteudoDeSecao(bypass);
    expect(limpo).not.toContain('onerror');
    expect(limpo).not.toContain('<xmp');
  });

  it('preserva formatacao legitima do laudo', () => {
    const legitimo = '<p>Paciente com <strong>fratura</strong> em fêmur.</p>';
    expect(sanitizarConteudoDeSecao(legitimo)).toContain('<strong>');
  });
});
