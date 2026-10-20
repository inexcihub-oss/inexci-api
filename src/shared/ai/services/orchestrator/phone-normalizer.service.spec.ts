import { Logger } from '@nestjs/common';
import { PhoneNormalizerService } from './phone-normalizer.service';

describe('PhoneNormalizerService', () => {
  const userRepoMock = { findManyByPhones: jest.fn() };
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
        expect.arrayContaining(['3198908579', '(31) 9890-8579']),
      );
    });

    it('inclui variante COM o nono dígito (10 → 11 dígitos)', () => {
      const result = service.normalizeInboundPhone('whatsapp:+553189085791');
      expect(result.lookupCandidates).toEqual(
        expect.arrayContaining([
          '+553189085791',
          '31989085791',
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
    it('consulta o canônico e as variantes legadas numa única ida ao banco', async () => {
      userRepoMock.findManyByPhones.mockResolvedValue([{ id: 'u-1' }]);

      const { canonicalPhone, lookupCandidates } =
        service.normalizeInboundPhone('whatsapp:+5511999998888');
      const user = await service.findUserByPhoneCandidates(
        canonicalPhone,
        lookupCandidates,
      );

      expect(user).toEqual({ id: 'u-1' });
      expect(userRepoMock.findManyByPhones).toHaveBeenCalledTimes(1);
      const [telefones] = userRepoMock.findManyByPhones.mock.calls[0];
      expect(telefones[0]).toBe('11999998888');
      expect(telefones).toEqual(
        expect.arrayContaining(['5511999998888', '+5511999998888']),
      );
    });

    it('acha pelo canônico quando o inbound vem sem o nono dígito', async () => {
      userRepoMock.findManyByPhones.mockResolvedValue([{ id: 'u-1' }]);

      await service.findUserByPhoneCandidates('+553189085791', [
        '+553189085791',
      ]);

      const [telefones] = userRepoMock.findManyByPhones.mock.calls[0];
      expect(telefones[0]).toBe('31989085791');
    });

    it('devolve null quando ninguém casa', async () => {
      userRepoMock.findManyByPhones.mockResolvedValue([]);

      const user = await service.findUserByPhoneCandidates('+5511999998888', [
        '+5511999998888',
      ]);

      expect(user).toBeNull();
    });

    it('recusa quando variantes casam usuários distintos, sem expor o número no log', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      userRepoMock.findManyByPhones.mockResolvedValue([
        { id: 'vitima', phone: '11987654321' },
        { id: 'atacante', phone: '5511987654321' },
      ]);

      const user = await service.findUserByPhoneCandidates('+5511987654321', [
        '+5511987654321',
        '5511987654321',
        '11987654321',
      ]);

      expect(user).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      const mensagem = String(warn.mock.calls[0][0]);
      expect(mensagem).toContain('AI_PHONE_AMBIGUOUS');
      expect(mensagem).not.toContain('87654321');
      warn.mockRestore();
    });

    it('não confunde o mesmo usuário repetido com ambiguidade', async () => {
      userRepoMock.findManyByPhones.mockResolvedValue([
        { id: 'u-1' },
        { id: 'u-1' },
      ]);

      const user = await service.findUserByPhoneCandidates('+5511999998888', [
        '+5511999998888',
      ]);

      expect(user).toEqual({ id: 'u-1' });
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
