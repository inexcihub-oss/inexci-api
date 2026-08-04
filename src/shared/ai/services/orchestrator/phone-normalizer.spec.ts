import { PhoneNormalizerService } from './phone-normalizer.service';

describe('PhoneNormalizerService.expandBrazilianLocalVariants', () => {
  const service = new PhoneNormalizerService({} as any);

  it('expande celular de 10 digitos locais (DDD + prefixo 6-9)', () => {
    // DDD 31 + 87654321 (celular antigo, prefixo 8) -> ganha o nono digito.
    const variantes = service.expandBrazilianLocalVariants('3187654321');
    expect(variantes).toContain('31987654321');
  });

  it('NAO expande numero fixo (DDD + prefixo 2-5)', () => {
    // DDD 31 + 34567890 e fixo (prefixo 3). Expandir gera 31934567890, que e
    // o celular de OUTRA pessoa — colisao que permitia assumir a sessao alheia.
    const variantes = service.expandBrazilianLocalVariants('3134567890');
    expect(variantes).not.toContain('31934567890');
  });
});
