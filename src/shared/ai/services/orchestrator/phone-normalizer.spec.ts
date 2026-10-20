import { PhoneNormalizerService } from './phone-normalizer.service';

describe('PhoneNormalizerService.expandBrazilianLocalVariants', () => {
  const service = new PhoneNormalizerService({} as any);

  it('expande celular de 10 digitos locais (DDD + prefixo 6-9)', () => {
    const variantes = service.expandBrazilianLocalVariants('3187654321');
    expect(variantes).toContain('31987654321');
  });

  it('NAO expande numero fixo (DDD + prefixo 2-5)', () => {
    const variantes = service.expandBrazilianLocalVariants('3134567890');
    expect(variantes).not.toContain('31934567890');
  });
});
