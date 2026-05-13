import { buildTussTools } from './tuss.tools';
import { ToolContext } from './tool.interface';
import { TussResponse } from '../../../modules/tuss/tuss.service';

const baseContext: ToolContext = {
  userId: 'user-1',
  phone: '+5511999999999',
  accessibleDoctorIds: ['doctor-1'],
  conversationId: 'conv-1',
};

function makeTussService(overrides: {
  lookup?: jest.Mock;
  findByExactCode?: jest.Mock;
}) {
  return {
    lookup: overrides.lookup ?? jest.fn().mockReturnValue([]),
    findByExactCode:
      overrides.findByExactCode ?? jest.fn().mockReturnValue(null),
    search: jest.fn(),
  } as any;
}

function fakeMatch(digits: string, name: string): TussResponse {
  // Replica o `formatTussCode` interno do TussService (10 dígitos →
  // `XX.XX.XX.XXX-X`). Garante que o teste reflete o que a tool real recebe.
  const padded = digits.padStart(10, '0');
  const formatted = `${padded.slice(0, 2)}.${padded.slice(2, 4)}.${padded.slice(4, 6)}.${padded.slice(6, 9)}-${padded.slice(9)}`;
  return { id: padded, tussCode: formatted, name, active: true };
}

describe('search_tuss_codes', () => {
  it('exige query com pelo menos 2 caracteres', async () => {
    const service = makeTussService({});
    const [tool] = buildTussTools(service);

    const result = await tool.execute({ query: 'a' }, baseContext);
    expect(result).toContain('ao menos 2 caracteres');
    expect(service.lookup).not.toHaveBeenCalled();
  });

  it('rejeita usuário sem userId no contexto', async () => {
    const service = makeTussService({});
    const [tool] = buildTussTools(service);

    const result = await tool.execute(
      { query: 'artroscopia' },
      { ...baseContext, userId: null },
    );

    expect(result).toBe('Acesso negado.');
    expect(service.lookup).not.toHaveBeenCalled();
  });

  it('usa findByExactCode quando query é numérica e existe', async () => {
    const exactMatch = fakeMatch('30713153', 'Artroscopia diag');
    const findByExactCode = jest.fn().mockReturnValue(exactMatch);
    const service = makeTussService({ findByExactCode });
    const [tool] = buildTussTools(service);

    const result = await tool.execute({ query: '30713153' }, baseContext);

    expect(findByExactCode).toHaveBeenCalledWith('30713153');
    expect(result).toContain(exactMatch.tussCode);
    expect(result).toContain('Artroscopia diag');
    // Quando o match exato é encontrado, lookup não precisa ser chamado.
    expect(service.lookup).not.toHaveBeenCalled();
  });

  it('cai para lookup quando query numérica não tem match exato', async () => {
    const matches = [
      fakeMatch('30713153', 'Artroscopia diag'),
      fakeMatch('30713162', 'Artroscopia trat'),
    ];
    const lookup = jest.fn().mockReturnValue(matches);
    const service = makeTussService({
      findByExactCode: jest.fn().mockReturnValue(null),
      lookup,
    });
    const [tool] = buildTussTools(service);

    const result = await tool.execute({ query: '30713' }, baseContext);

    expect(lookup).toHaveBeenCalledWith('30713', 10);
    expect(result).toContain(matches[0].tussCode);
    expect(result).toContain(matches[1].tussCode);
  });

  it('busca por descrição parcial usando lookup', async () => {
    const match = fakeMatch('30713153', 'Artroscopia diagnóstica');
    const lookup = jest.fn().mockReturnValue([match]);
    const service = makeTussService({ lookup });
    const [tool] = buildTussTools(service);

    const result = await tool.execute(
      { query: 'artroscopia', limit: 5 },
      baseContext,
    );

    expect(lookup).toHaveBeenCalledWith('artroscopia', 5);
    expect(result).toContain('Códigos TUSS');
    expect(result).toContain('Artroscopia diagnóstica');
    expect(result).toContain(match.tussCode);
  });

  it('respeita limite máximo de 30 e mínimo de 1', async () => {
    const lookup = jest.fn().mockReturnValue([]);
    const service = makeTussService({ lookup });
    const [tool] = buildTussTools(service);

    await tool.execute({ query: 'biopsia', limit: 999 }, baseContext);
    expect(lookup).toHaveBeenLastCalledWith('biopsia', 30);

    await tool.execute({ query: 'biopsia', limit: 0 }, baseContext);
    expect(lookup).toHaveBeenLastCalledWith('biopsia', 1);
  });

  it('retorna mensagem amigável quando nada é encontrado', async () => {
    const service = makeTussService({
      lookup: jest.fn().mockReturnValue([]),
    });
    const [tool] = buildTussTools(service);

    const result = await tool.execute({ query: 'xyzwxyz' }, baseContext);

    expect(result).toContain('Nenhum código TUSS encontrado');
    expect(result).toContain('xyzwxyz');
  });
});
