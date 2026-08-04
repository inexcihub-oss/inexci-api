import { isAllowedHost } from './pdf.service';

describe('PdfService — allowlist de host (SSRF)', () => {
  it('aceita o bucket R2 legitimo', () => {
    expect(
      isAllowedHost('https://abc123.r2.cloudflarestorage.com/documento.png'),
    ).toBe(true);
  });

  it('recusa metadata da AWS', () => {
    expect(isAllowedHost('http://169.254.169.254/latest/meta-data/')).toBe(
      false,
    );
  });

  it('recusa servico interno da rede docker', () => {
    expect(isAllowedHost('http://alloy:12345/')).toBe(false);
    expect(isAllowedHost('http://stt-service:8000/')).toBe(false);
  });

  it('recusa host arbitrario da AWS controlavel pelo atacante', () => {
    // A allowlist antiga aceitava qualquer *.amazonaws.com, o que inclui
    // API Gateway e Lambda Function URLs — controlaveis por qualquer pessoa.
    expect(
      isAllowedHost('https://xyz.execute-api.us-east-1.amazonaws.com/p/r'),
    ).toBe(false);
  });

  it('recusa http mesmo em host permitido', () => {
    expect(isAllowedHost('http://abc123.r2.cloudflarestorage.com/x.png')).toBe(
      false,
    );
  });
});
