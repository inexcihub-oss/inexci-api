import { Logger } from '@nestjs/common';
import {
  ResponseNormalizerService,
  WHATSAPP_TARGET_LENGTH,
} from './response-normalizer.service';

describe('ResponseNormalizerService', () => {
  let service: ResponseNormalizerService;

  beforeEach(() => {
    service = new ResponseNormalizerService();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('normalizeWhatsappText', () => {
    const norm = (text: string) => service.normalizeWhatsappText(text);

    it('remove bloco de código (``` ... ```)', () => {
      const input = 'Aqui está:\n```json\n{"status": "ok"}\n```\nPronte.';
      const result = norm(input);
      expect(result).not.toContain('```');
      expect(result).not.toContain('{');
      expect(result).toContain('Aqui está');
      expect(result).toContain('Pronte');
    });

    it('strip JSON-like inline e loga warning', () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const input = 'Resultado: {"status":"ok","id":"SC-001"} tudo certo.';
      const result = norm(input);
      expect(result).not.toContain('{');
      expect(result).toContain('tudo certo');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('NORMALIZE_WHATSAPP_TEXT'),
      );
    });

    it('remove **negrito** mantendo o texto', () => {
      expect(norm('Texto **importante** aqui.')).toBe('Texto importante aqui.');
    });

    it('remove __sublinhado__ mantendo o texto', () => {
      expect(norm('Texto __sublinhado__ aqui.')).toBe('Texto sublinhado aqui.');
    });

    it('remove cabeçalhos Markdown (#, ##)', () => {
      expect(norm('## Título\nConteúdo')).toBe('Título\nConteúdo');
      expect(norm('# H1\nTexto')).toBe('H1\nTexto');
    });

    it('remove link Markdown [texto](url) mantendo só o texto', () => {
      expect(norm('Veja [aqui](https://inexci.com.br) os detalhes.')).toBe(
        'Veja aqui os detalhes.',
      );
    });

    it('remove linhas de tabela Markdown (|...|)', () => {
      const input = '| SC | Status |\n| --- | --- |\n| SC-001 | Pendente |';
      const result = norm(input);
      expect(result).not.toContain('|');
    });

    it('remove emojis (MAX_EMOJIS_PER_RESPONSE = 0)', () => {
      const result = norm('Pronto ✅ tudo certo 📅.');
      expect(result).not.toMatch(/[\p{Extended_Pictographic}]/u);
      expect(result).toContain('Pronto');
      expect(result).toContain('tudo certo');
    });

    it('colapsa múltiplas linhas em branco consecutivas em uma só', () => {
      const input = 'Linha 1\n\n\n\nLinha 2';
      const result = norm(input);
      expect(result).not.toMatch(/\n{3,}/);
    });

    it('trunca em WHATSAPP_TARGET_LENGTH com sufixo quando exceder', () => {
      const longText = 'A'.repeat(900);
      const result = norm(longText);
      expect(result.length).toBeLessThanOrEqual(WHATSAPP_TARGET_LENGTH);
      expect(result).toContain('Acesse a plataforma para mais detalhes');
    });

    it('converte listas com bullet em opções numeradas', () => {
      const input = '• criar SC\n• ver pacientes\n• encerrar';
      const result = norm(input);
      expect(result).toContain('1 - criar SC');
      expect(result).toContain('2 - ver pacientes');
      expect(result).toContain('3 - encerrar');
    });

    it('remove aspas duplas envoltas em volta da resposta inteira', () => {
      expect(norm('"Tudo certo!"')).toBe('Tudo certo!');
    });

    it('substitui texto vazio por mensagem padrão', () => {
      expect(norm('   \n  ')).toBe(
        'Desculpe, não consegui processar sua solicitação.',
      );
    });

    it('aceita texto null/undefined sem quebrar', () => {
      expect(norm(null as unknown as string)).toBe(
        'Desculpe, não consegui processar sua solicitação.',
      );
      expect(norm(undefined as unknown as string)).toBe(
        'Desculpe, não consegui processar sua solicitação.',
      );
    });
  });

  describe('scrubResidualPlaceholders', () => {
    it('substitui placeholder conhecido pelo termo amigável e loga warning', () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const text = 'O protocolo {{protocol_1}} foi criado.';
      const result = service.scrubResidualPlaceholders(text, 'sess', 'sid-1');
      expect(result).toBe('O protocolo essa solicitação foi criado.');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('AI_PLACEHOLDER_LEAK'),
      );
    });

    it('usa fallback genérico para categoria desconhecida', () => {
      const text = 'Valor {{foobar_3}} indisponível.';
      const result = service.scrubResidualPlaceholders(text, 'sess', 'sid-2');
      expect(result).toBe('Valor [informação não disponível] indisponível.');
    });

    it('não modifica texto sem placeholders', () => {
      const text = 'Sem placeholders aqui.';
      expect(service.scrubResidualPlaceholders(text, 'sess', 'sid')).toBe(text);
    });

    it('aceita texto vazio sem quebrar', () => {
      expect(service.scrubResidualPlaceholders('', 'sess', 'sid')).toBe('');
    });

    it('agrupa múltiplos placeholders no log', () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const text =
        '{{protocol_1}} {{patient_name_1}} {{protocol_2}} {{patient_name_3}}';
      service.scrubResidualPlaceholders(text, 'sess', 'sid');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = warnSpy.mock.calls[0][0] as string;
      expect(message).toMatch(/protocol=2/);
      expect(message).toMatch(/patient_name=2/);
    });
  });

  describe('limitEmojis', () => {
    it('mantém o texto inalterado quando max for grande', () => {
      const text = 'Pronto ✅ tudo certo 📅.';
      expect(service.limitEmojis(text, 5)).toBe(text);
    });

    it('remove todos os emojis quando max=0', () => {
      const text = 'Pronto ✅ tudo certo 📅.';
      const result = service.limitEmojis(text, 0);
      expect(result).not.toMatch(/[\p{Extended_Pictographic}]/u);
    });

    it('remove emoji com seletor de variação \\uFE0F', () => {
      const text = 'Atenção ℹ️ aqui.';
      const result = service.limitEmojis(text, 0);
      expect(result).toBe('Atenção  aqui.');
    });
  });

  describe('cleanEmojiArtifacts', () => {
    it('colapsa espaços duplicados', () => {
      expect(service.cleanEmojiArtifacts('Pronto    tudo certo.')).toBe(
        'Pronto tudo certo.',
      );
    });

    it('remove espaços antes de pontuação', () => {
      expect(service.cleanEmojiArtifacts('Vamos lá .')).toBe('Vamos lá.');
    });

    it('remove indentação inicial das linhas', () => {
      expect(service.cleanEmojiArtifacts('   Linha 1\n   Linha 2')).toBe(
        'Linha 1\nLinha 2',
      );
    });
  });

  describe('isListLine / extractListLineContent', () => {
    it('detecta linha bullet com •', () => {
      expect(service.isListLine('• item')).toBe(true);
      expect(service.extractListLineContent('• item')).toBe('item');
    });

    it('detecta linha numerada com 1) 1- 1.', () => {
      expect(service.isListLine('1) opção')).toBe(true);
      expect(service.isListLine('2- opção')).toBe(true);
      expect(service.isListLine('3. opção')).toBe(true);
      expect(service.extractListLineContent('1) opção')).toBe('opção');
    });

    it('rejeita linha comum', () => {
      expect(service.isListLine('opção')).toBe(false);
    });
  });

  describe('convertListLinesToOptions', () => {
    it('converte bloco contínuo em opções numeradas', () => {
      const result = service.convertListLinesToOptions(['• a', '• b', '• c']);
      expect(result).toEqual(['1 - a', '2 - b', '3 - c']);
    });

    it('preserva linhas não-lista intercaladas', () => {
      const result = service.convertListLinesToOptions([
        'Cabeçalho',
        '• a',
        '• b',
        'Rodapé',
      ]);
      expect(result).toEqual(['Cabeçalho', '1 - a', '2 - b', 'Rodapé']);
    });
  });
});
