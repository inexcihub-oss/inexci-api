import {
  buildPaginatedToolResult,
  serializeToolResult,
  ToolResultEnvelope,
  TOOL_RESULT_MAX_DATA_BYTES,
} from './tool-result.envelope';

describe('serializeToolResult', () => {
  it('produz JSON válido com status, summary e data', () => {
    const env: ToolResultEnvelope = {
      status: 'ok',
      summary: 'feito',
      data: { id: '1' },
    };
    const json = serializeToolResult(env);
    expect(JSON.parse(json)).toEqual(env);
  });
});

describe('buildPaginatedToolResult', () => {
  it('retorna tudo quando cabe no limit', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ id: `${i}` }));
    const env = buildPaginatedToolResult({
      summary: 'lista de pacientes',
      allItems: items,
      limit: 20,
    });
    expect(env.data.items).toHaveLength(5);
    expect(env.data.total).toBe(5);
    expect(env.data.truncated).toBe(false);
    expect(env.data.next_cursor).toBeNull();
  });

  it('marca truncated quando excede limit', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ id: `${i}` }));
    const env = buildPaginatedToolResult({
      summary: 'muitos itens',
      allItems: items,
      limit: 10,
      nextCursor: 'cursor:10',
    });
    expect(env.data.items).toHaveLength(10);
    expect(env.data.total).toBe(30);
    expect(env.data.truncated).toBe(true);
    expect(env.data.next_cursor).toBe('cursor:10');
  });

  it('reduz limit progressivamente até caber em MAX_DATA_BYTES', () => {
    // Cada item tem ~5KB de payload → limit=20 estoura.
    const big = 'x'.repeat(5 * 1024);
    const items = Array.from({ length: 20 }, (_, i) => ({
      id: `${i}`,
      blob: big,
    }));
    const env = buildPaginatedToolResult({
      summary: 'lista pesada',
      allItems: items,
      limit: 20,
    });
    const size = Buffer.byteLength(JSON.stringify(env), 'utf8');
    expect(size).toBeLessThanOrEqual(TOOL_RESULT_MAX_DATA_BYTES);
    expect(env.data.items.length).toBeLessThan(20);
    expect(env.data.truncated).toBe(true);
  });
});
