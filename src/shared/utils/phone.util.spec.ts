import {
  TELEFONE_BR_CANONICO,
  TELEFONE_BR_CANONICO_SQL,
  canonicalizarTelefone,
  reduzirTelefone,
  telefoneCanonicoSql,
  variantesLegadasDoTelefone,
} from './phone.util';

describe('canonicalizarTelefone', () => {
  it.each([
    ['11987654321', '11987654321'],
    ['(11) 98765-4321', '11987654321'],
    ['+55 (11) 98765-4321', '11987654321'],
    ['5511987654321', '11987654321'],
    ['whatsapp:+5511987654321', '11987654321'],
    ['011987654321', '11987654321'],
    ['01987654321', '19987654321'],
    ['005511987654321', '11987654321'],
    ['1187654321', '11987654321'],
    ['+551187654321', '11987654321'],
    ['1132345678', '1132345678'],
    ['551132345678', '1132345678'],
    ['55991234567', '55991234567'],
    ['5555991234567', '55991234567'],
  ])('%s vira %s', (entrada, esperado) => {
    expect(canonicalizarTelefone(entrada)).toBe(esperado);
  });

  it('as grafias do ataque (local x com DDI) colapsam no mesmo valor', () => {
    expect(canonicalizarTelefone('11987654321')).toBe(
      canonicalizarTelefone('5511987654321'),
    );
    expect(canonicalizarTelefone('+5511987654321')).toBe(
      canonicalizarTelefone('1187654321'),
    );
  });

  it.each([
    [''],
    ['12345'],
    ['10987654321'],
    ['11887654321'],
    ['1112345678'],
    ['119876543210'],
    ['+1 415 555 2671'],
    ['abc'],
  ])('recusa %p', (entrada) => {
    expect(canonicalizarTelefone(entrada)).toBeNull();
  });

  it('tolera null/undefined', () => {
    expect(canonicalizarTelefone(null)).toBeNull();
    expect(canonicalizarTelefone(undefined)).toBeNull();
  });

  it('o resultado sempre cabe na coluna users.phone (varchar 15)', () => {
    const canonico = canonicalizarTelefone('+55 (11) 98765-4321');
    expect(canonico!.length).toBeLessThanOrEqual(15);
  });

  it('reduzirTelefone não valida, só reduz', () => {
    expect(reduzirTelefone('12345')).toBe('12345');
    expect(TELEFONE_BR_CANONICO.test(reduzirTelefone('12345'))).toBe(false);
  });
});

describe('variantesLegadasDoTelefone', () => {
  it('cobre local, com DDI e sem o nono dígito, com o canônico primeiro', () => {
    const variantes = variantesLegadasDoTelefone('11987654321');
    expect(variantes[0]).toBe('11987654321');
    expect(variantes).toEqual(
      expect.arrayContaining([
        '5511987654321',
        '+5511987654321',
        '1187654321',
        '551187654321',
        '+551187654321',
      ]),
    );
    expect(new Set(variantes).size).toBe(variantes.length);
  });

  it('fixo não ganha variante sem nono dígito', () => {
    expect(variantesLegadasDoTelefone('1132345678')).toEqual([
      '1132345678',
      '551132345678',
      '+551132345678',
    ]);
  });

  it('valor não canônico não gera variante', () => {
    expect(variantesLegadasDoTelefone('12345')).toEqual([]);
  });
});

describe('telefoneCanonicoSql', () => {
  const sql = telefoneCanonicoSql('u."phone"');

  it('só usa funções imutáveis do Postgres (vale em índice de expressão)', () => {
    expect(sql).toContain('regexp_replace(u."phone"');
    expect(sql).not.toMatch(/\b(now|current_|random)\b/i);
  });

  it('espelha as regras do TypeScript: zeros à esquerda, DDI 55 e nono dígito', () => {
    expect(sql).toContain(
      "ltrim(regexp_replace(u.\"phone\", '[^0-9]', '', 'g'), '0')",
    );
    expect(sql).toContain('IN (12, 13)');
    expect(sql).toContain("= '55'");
    expect(sql).toContain("IN ('6', '7', '8', '9')");
    expect(sql).toMatch(/^NULLIF\(/);
  });

  it('a regex SQL aceita e recusa os mesmos exemplos da regex TypeScript', () => {
    const regexSql = new RegExp(TELEFONE_BR_CANONICO_SQL);
    for (const valor of [
      '11987654321',
      '1132345678',
      '11887654321',
      '01987654321',
      '1112345678',
    ]) {
      expect(regexSql.test(valor)).toBe(TELEFONE_BR_CANONICO.test(valor));
    }
  });
});
