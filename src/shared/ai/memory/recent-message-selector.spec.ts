import {
  RecentMessageSelector,
  SelectableMessage,
} from './recent-message-selector';

function msg(
  i: number,
  role: 'user' | 'assistant' | 'tool',
  content: string,
  toolName?: string,
): SelectableMessage {
  return {
    role,
    content,
    toolName: toolName ?? null,
    createdAt: new Date(2026, 0, 1, 0, 0, i),
  };
}

describe('RecentMessageSelector', () => {
  const sel = new RecentMessageSelector();

  it('quando count <= max devolve tudo', () => {
    const r = sel.select({
      messages: [msg(1, 'user', 'oi'), msg(2, 'assistant', 'olá')],
      maxCount: 5,
    });
    expect(r).toHaveLength(2);
  });

  it('garante a última user', () => {
    const messages: SelectableMessage[] = [
      msg(1, 'user', 'antiga user'),
      msg(2, 'assistant', 'r1'),
      msg(3, 'assistant', 'r2'),
      msg(4, 'assistant', 'r3'),
      msg(5, 'assistant', 'r4'),
      msg(6, 'user', 'última user'),
    ];
    const r = sel.select({ messages, maxCount: 3 });
    expect(r.some((m) => m.content === 'última user')).toBe(true);
  });

  it('inclui resultados com toolName', () => {
    const messages: SelectableMessage[] = [
      msg(1, 'user', 'oi'),
      msg(2, 'tool', '{"ok":true}', 'query_patients'),
      msg(3, 'assistant', 'enche'),
      msg(4, 'assistant', 'enche'),
      msg(5, 'assistant', 'enche'),
      msg(6, 'user', 'follow up'),
    ];
    const r = sel.select({ messages, maxCount: 3 });
    expect(r.some((m) => m.toolName === 'query_patients')).toBe(true);
  });

  it('inclui mensagens com âncoras', () => {
    const messages: SelectableMessage[] = [
      msg(1, 'user', 'cria SC para SC-0042'),
      msg(2, 'assistant', 'enche 1'),
      msg(3, 'assistant', 'enche 2'),
      msg(4, 'assistant', 'enche 3'),
      msg(5, 'assistant', 'enche 4'),
      msg(6, 'user', 'continua'),
    ];
    const r = sel.select({
      messages,
      maxCount: 3,
      anchors: ['SC-0042'],
    });
    expect(r.some((m) => m.content.includes('SC-0042'))).toBe(true);
  });

  it('retorna em ordem cronológica', () => {
    const messages: SelectableMessage[] = [
      msg(1, 'user', 'a'),
      msg(2, 'assistant', 'b'),
      msg(3, 'user', 'c'),
    ];
    const r = sel.select({ messages, maxCount: 2 });
    const times = r.map((m) => m.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
