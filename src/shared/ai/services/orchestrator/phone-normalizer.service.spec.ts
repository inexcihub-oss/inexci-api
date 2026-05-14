import { PhoneNormalizerService } from './phone-normalizer.service';

describe('PhoneNormalizerService', () => {
  const userRepoMock = { findOneByPhone: jest.fn() };
  let service: PhoneNormalizerService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PhoneNormalizerService(userRepoMock as any);
  });

  describe('normalizeInboundPhone', () => {
    it('remove o prefixo whatsapp: e converte para +55…', () => {
      const result = service.normalizeInboundPhone('whatsapp:+5511999998888');
      expect(result.canonicalPhone).toBe('+5511999998888');
      expect(result.lookupCandidates[0]).toBe('+5511999998888');
    });

    it('aceita número sem prefixo whatsapp e força DDI 55', () => {
      const result = service.normalizeInboundPhone('11999998888');
      expect(result.canonicalPhone).toBe('+5511999998888');
      expect(result.lookupCandidates).toContain('11999998888');
    });

    it('preserva DDI 55 já presente no input bruto', () => {
      const result = service.normalizeInboundPhone('+5521988887777');
      expect(result.canonicalPhone).toBe('+5521988887777');
      expect(result.lookupCandidates).toContain('+5521988887777');
    });

    it('gera variantes formatadas com parênteses/hífen para 11 dígitos', () => {
      const result = service.normalizeInboundPhone('whatsapp:+5511999998888');
      expect(result.lookupCandidates).toEqual(
        expect.arrayContaining([
          '+5511999998888',
          '5511999998888',
          '11999998888',
          '(11) 99999-8888',
          '11 99999-8888',
          '1199999-8888',
        ]),
      );
    });

    it('inclui variante sem o nono dígito (11 → 10 dígitos)', () => {
      const result = service.normalizeInboundPhone('whatsapp:+5531998908579');
      expect(result.lookupCandidates).toEqual(
        expect.arrayContaining([
          '3198908579', // sem nono dígito
          '(31) 9890-8579',
        ]),
      );
    });

    it('inclui variante COM o nono dígito (10 → 11 dígitos)', () => {
      const result = service.normalizeInboundPhone('whatsapp:+553189085791');
      expect(result.lookupCandidates).toEqual(
        expect.arrayContaining([
          '+553189085791', // canonical
          '31989085791', // com nono dígito
          '(31) 98908-5791',
        ]),
      );
    });

    it('retorna canonical=raw e candidates apenas com o raw quando input é vazio/sem dígitos', () => {
      const result = service.normalizeInboundPhone('whatsapp:abc');
      expect(result.canonicalPhone).toBe('abc');
      expect(result.lookupCandidates).toEqual(['abc']);
    });

    it('lida com input null/undefined sem quebrar', () => {
      const result = service.normalizeInboundPhone(undefined as any);
      expect(result.canonicalPhone).toBe('');
      expect(result.lookupCandidates).toEqual([]);
    });

    it('deduplica candidates iguais', () => {
      const result = service.normalizeInboundPhone('+5511999998888');
      const set = new Set(result.lookupCandidates);
      expect(set.size).toBe(result.lookupCandidates.length);
    });
  });

  describe('findUserByPhoneCandidates', () => {
    it('devolve o primeiro hit no lookup', async () => {
      userRepoMock.findOneByPhone
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'u-1' });

      const user = await service.findUserByPhoneCandidates('+5511999998888', [
        'a',
        'b',
      ]);
      expect(user).toEqual({ id: 'u-1' });
      expect(userRepoMock.findOneByPhone).toHaveBeenNthCalledWith(1, 'a');
      expect(userRepoMock.findOneByPhone).toHaveBeenNthCalledWith(2, 'b');
    });

    it('cai no primaryPhone quando nenhum candidato casa', async () => {
      userRepoMock.findOneByPhone
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'u-2' });

      const user = await service.findUserByPhoneCandidates('+5511999998888', [
        'a',
        'b',
      ]);
      expect(user).toEqual({ id: 'u-2' });
      expect(userRepoMock.findOneByPhone).toHaveBeenNthCalledWith(
        3,
        '+5511999998888',
      );
    });

    it('não duplica chamada quando primaryPhone já está nos candidates', async () => {
      userRepoMock.findOneByPhone.mockResolvedValue(null);

      const user = await service.findUserByPhoneCandidates('+5511999998888', [
        '+5511999998888',
        'b',
      ]);
      expect(user).toBeNull();
      expect(userRepoMock.findOneByPhone).toHaveBeenCalledTimes(2);
    });
  });

  describe('maskPhone', () => {
    it('mascara o número preservando o prefixo +55 e parte final', () => {
      const result = service.maskPhone('+5511999998888');
      expect(result).not.toBe('+5511999998888');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
