import {
  buildProtocolCandidates,
  collapseDuplicatedScPrefixes,
  formatScProtocolForDisplay,
  stripScPrefix,
} from './protocol.helpers';

describe('protocol.helpers', () => {
  describe('stripScPrefix', () => {
    it('remove um prefixo SC- simples', () => {
      expect(stripScPrefix('SC-468131')).toBe('468131');
    });

    it('remove TODOS os prefixos SC- consecutivos (regressão SC-SC-)', () => {
      expect(stripScPrefix('SC-SC-468131')).toBe('468131');
      expect(stripScPrefix('SC-SC-SC-468131')).toBe('468131');
    });

    it('é case-insensitive', () => {
      expect(stripScPrefix('sc-468131')).toBe('468131');
      expect(stripScPrefix('Sc-Sc-468131')).toBe('468131');
    });

    it('mantém o valor quando não há prefixo SC-', () => {
      expect(stripScPrefix('468131')).toBe('468131');
    });

    it('devolve string vazia para entradas vazias', () => {
      expect(stripScPrefix('')).toBe('');
      expect(stripScPrefix(null)).toBe('');
      expect(stripScPrefix(undefined)).toBe('');
    });
  });

  describe('formatScProtocolForDisplay', () => {
    it('prefixa SC- e normaliza para maiúsculas', () => {
      expect(formatScProtocolForDisplay('468131')).toBe('SC-468131');
      expect(formatScProtocolForDisplay('abc123')).toBe('SC-ABC123');
    });

    it('não duplica prefixo quando já vem com SC-', () => {
      expect(formatScProtocolForDisplay('SC-468131')).toBe('SC-468131');
      expect(formatScProtocolForDisplay('SC-SC-468131')).toBe('SC-468131');
    });

    it('devolve placeholder quando vazio', () => {
      expect(formatScProtocolForDisplay('')).toBe('SC-N/D');
      expect(formatScProtocolForDisplay(null)).toBe('SC-N/D');
    });
  });

  describe('buildProtocolCandidates', () => {
    it('gera candidato cru e versão SC- prefixada', () => {
      const candidates = buildProtocolCandidates('468131');
      expect(candidates).toContain('468131');
      expect(candidates).toContain('SC-468131');
    });

    it('gera candidato sem prefixo a partir de SC-XXXX', () => {
      const candidates = buildProtocolCandidates('SC-468131');
      expect(candidates).toContain('SC-468131');
      expect(candidates).toContain('468131');
    });

    it('é case-insensitive (devolve sempre em maiúsculas)', () => {
      const candidates = buildProtocolCandidates('sc-abc123');
      expect(candidates).toContain('SC-ABC123');
      expect(candidates).toContain('ABC123');
    });

    it('NÃO tolera SC-SC-XXXX (a defesa correta é impedir a duplicação na saída)', () => {
      const candidates = buildProtocolCandidates('SC-SC-468131');
      // Não devolve "468131" porque "SC-SC-468131" não é um identificador
      // válido — o `collapseDuplicatedScPrefixes` no orchestrator é quem
      // sanea esse caso antes que ele chegue ao lookup.
      expect(candidates).not.toContain('468131');
    });

    it('devolve lista vazia para entradas vazias', () => {
      expect(buildProtocolCandidates('')).toEqual([]);
      expect(buildProtocolCandidates('   ')).toEqual([]);
    });
  });

  describe('collapseDuplicatedScPrefixes', () => {
    it('colapsa SC-SC-XXXX em SC-XXXX', () => {
      expect(collapseDuplicatedScPrefixes('SC-SC-468131')).toBe('SC-468131');
    });

    it('colapsa três ou mais prefixos consecutivos', () => {
      expect(collapseDuplicatedScPrefixes('SC-SC-SC-468131')).toBe(
        'SC-468131',
      );
    });

    it('preserva ocorrências legítimas (SC- único + sufixo)', () => {
      expect(collapseDuplicatedScPrefixes('A SC-468131 está pronta.')).toBe(
        'A SC-468131 está pronta.',
      );
    });

    it('colapsa múltiplas ocorrências em um mesmo texto', () => {
      expect(
        collapseDuplicatedScPrefixes(
          'A SC-SC-468131 e a SC-SC-9999 foram atualizadas.',
        ),
      ).toBe('A SC-468131 e a SC-9999 foram atualizadas.');
    });

    it('é case-insensitive mas preserva o case original', () => {
      expect(collapseDuplicatedScPrefixes('sc-sc-468131')).toBe('sc-468131');
    });

    it('colapsa também antes de placeholders do vault (histórico)', () => {
      expect(
        collapseDuplicatedScPrefixes('SC-SC-{{protocol_1}} está pronta.'),
      ).toBe('SC-{{protocol_1}} está pronta.');
    });

    it('não altera texto sem prefixo SC-', () => {
      expect(collapseDuplicatedScPrefixes('Olá, tudo bem?')).toBe(
        'Olá, tudo bem?',
      );
    });

    it('não toca em texto contendo apenas "SC-" sem sufixo válido', () => {
      expect(collapseDuplicatedScPrefixes('SC- ')).toBe('SC- ');
    });

    it('lida com entradas vazias sem quebrar', () => {
      expect(collapseDuplicatedScPrefixes('')).toBe('');
    });
  });
});
