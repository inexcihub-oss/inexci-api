import {
  parseCpfs,
  isValidCpfChecksum,
  parseCnpjs,
  isValidCnpjChecksum,
  parseCrms,
  parseTussCodes,
  parseCidCodes,
  parseDates,
  parsePhones,
  parseMoney,
} from './index';

describe('CPF parser', () => {
  it('valida checksum oficial', () => {
    expect(isValidCpfChecksum('11144477735')).toBe(true);
    expect(isValidCpfChecksum('12345678900')).toBe(false);
    expect(isValidCpfChecksum('11111111111')).toBe(false);
  });

  it('extrai e formata CPF válido', () => {
    const r = parseCpfs('paciente CPF 111.444.777-35 nasceu em 1990');
    expect(r).toHaveLength(1);
    expect(r[0].value).toBe('111.444.777-35');
    expect(r[0].confidence).toBe(1);
  });

  it('CPF sem pontuação ainda é detectado', () => {
    const r = parseCpfs('CPF 11144477735');
    expect(r[0].value).toBe('111.444.777-35');
  });

  it('CPF com checksum inválido tem confidence 0.4', () => {
    const r = parseCpfs('CPF 123.456.789-00');
    expect(r[0].confidence).toBe(0.4);
  });
});

describe('CNPJ parser', () => {
  it('valida checksum', () => {
    expect(isValidCnpjChecksum('11222333000181')).toBe(true);
    expect(isValidCnpjChecksum('00000000000000')).toBe(false);
  });

  it('extrai CNPJ formatado', () => {
    const r = parseCnpjs('hospital CNPJ 11.222.333/0001-81');
    expect(r[0].value).toBe('11.222.333/0001-81');
    expect(r[0].confidence).toBe(1);
  });
});

describe('CRM parser', () => {
  it('extrai CRM com UF', () => {
    const r = parseCrms('Dr. João CRM-SP 12345');
    expect(r[0].value).toBe('CRM-SP 12345');
  });

  it('aceita variações com espaço/barra', () => {
    const r = parseCrms('CRM/RJ 67890 e CRM SP 11111');
    expect(r).toHaveLength(2);
  });
});

describe('TUSS parser', () => {
  it('extrai códigos de 8 dígitos', () => {
    const r = parseTussCodes('TUSS 30602114, outro: 30704018');
    expect(r.map((x) => x.value).sort()).toEqual(['30602114', '30704018']);
  });

  it('cross-ref aumenta confidence', () => {
    const r = parseTussCodes('TUSS 30602114', (c) => c === '30602114');
    expect(r[0].confidence).toBe(1);
  });
});

describe('CID parser', () => {
  it('extrai CIDs com ponto', () => {
    const r = parseCidCodes('CID M17.1 outro J45');
    const values = r.map((x) => x.value).sort();
    expect(values).toContain('M17.1');
    expect(values).toContain('J45');
  });
});

describe('Date parser', () => {
  it('ISO yyyy-mm-dd', () => {
    const r = parseDates('agendar para 2026-06-10');
    expect(r[0].value).toBe('2026-06-10');
  });
  it('BR dd/mm/yyyy', () => {
    const r = parseDates('agendar para 10/06/2026');
    expect(r[0].value).toBe('2026-06-10');
  });
  it('PT-BR por extenso', () => {
    const r = parseDates('10 de junho de 2026');
    expect(r[0].value).toBe('2026-06-10');
  });
  it('rejeita data impossível', () => {
    const r = parseDates('40/13/2026');
    expect(r).toHaveLength(0);
  });
});

describe('Phone parser', () => {
  it('extrai (DDD) NNNNN-NNNN', () => {
    const r = parsePhones('telefone (11) 98765-4321');
    expect(r[0].value).toBe('(11) 98765-4321');
  });
  it('rejeita DDD inválido', () => {
    const r = parsePhones('telefone (00) 12345-6789');
    expect(r).toHaveLength(0);
  });
});

describe('Money parser', () => {
  it('R$ 1.234,56', () => {
    const r = parseMoney('total R$ 1.234,56');
    expect(r[0].value).toBe(1234.56);
  });
  it('"reais" notation', () => {
    const r = parseMoney('total 5000 reais');
    expect(r[0].value).toBe(5000);
  });
});
