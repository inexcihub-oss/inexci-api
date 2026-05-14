import { buildCidTools } from './cid.tools';
import { ToolContext } from './tool.interface';
import { CidResponse } from '../../../modules/surgery-requests/cid/cid.service';

const baseContext: ToolContext = {
  userId: 'user-1',
  phone: '+5511999999999',
  accessibleDoctorIds: ['doctor-1'],
  conversationId: 'conv-1',
};

function makeCidService(overrides: {
  lookup?: jest.Mock;
  findByExactCode?: jest.Mock;
}) {
  return {
    lookup: overrides.lookup ?? jest.fn().mockReturnValue([]),
    findByExactCode:
      overrides.findByExactCode ?? jest.fn().mockReturnValue(null),
    findAll: jest.fn(),
  } as any;
}

function fakeMatch(code: string, description: string): CidResponse {
  return { id: code, code, description };
}

describe('search_cid_codes', () => {
  it('exige query com pelo menos 2 caracteres', async () => {
    const service = makeCidService({});
    const [tool] = buildCidTools(service);

    const result = await tool.execute({ query: 'a' }, baseContext);
    expect(result).toContain('ao menos 2 caracteres');
    expect(service.lookup).not.toHaveBeenCalled();
  });

  it('rejeita usuário sem userId no contexto', async () => {
    const service = makeCidService({});
    const [tool] = buildCidTools(service);

    const result = await tool.execute(
      { query: 'M171' },
      { ...baseContext, userId: null },
    );

    expect(result).toBe('Acesso negado.');
    expect(service.lookup).not.toHaveBeenCalled();
  });

  it('usa findByExactCode quando query parece um código CID válido', async () => {
    const exactMatch = fakeMatch('M171', 'Outras Gonartroses Primárias');
    const findByExactCode = jest.fn().mockReturnValue(exactMatch);
    const service = makeCidService({ findByExactCode });
    const [tool] = buildCidTools(service);

    const result = await tool.execute({ query: 'M171' }, baseContext);

    expect(findByExactCode).toHaveBeenCalledWith('M171');
    expect(result).toContain('M171');
    expect(result).toContain('Outras Gonartroses Primárias');
    expect(service.lookup).not.toHaveBeenCalled();
  });

  it('aceita código com ponto (M17.1) usando findByExactCode', async () => {
    const exactMatch = fakeMatch('M171', 'Outras Gonartroses Primárias');
    const findByExactCode = jest.fn().mockReturnValue(exactMatch);
    const service = makeCidService({ findByExactCode });
    const [tool] = buildCidTools(service);

    const result = await tool.execute({ query: 'M17.1' }, baseContext);

    expect(findByExactCode).toHaveBeenCalledWith('M17.1');
    expect(result).toContain('M171');
  });

  it('cai para lookup quando código não tem match exato', async () => {
    const matches = [
      fakeMatch('M171', 'Outras Gonartroses Primárias'),
      fakeMatch('M172', 'Gonartrose Pós-traumática Bilateral'),
    ];
    const lookup = jest.fn().mockReturnValue(matches);
    const service = makeCidService({
      findByExactCode: jest.fn().mockReturnValue(null),
      lookup,
    });
    const [tool] = buildCidTools(service);

    const result = await tool.execute({ query: 'M17' }, baseContext);

    expect(lookup).toHaveBeenCalledWith('M17', 10);
    expect(result).toContain('M171');
    expect(result).toContain('M172');
  });

  it('busca por descrição parcial usando lookup (não tenta findByExactCode)', async () => {
    const match = fakeMatch('M171', 'Outras Gonartroses Primárias');
    const lookup = jest.fn().mockReturnValue([match]);
    const findByExactCode = jest.fn();
    const service = makeCidService({ lookup, findByExactCode });
    const [tool] = buildCidTools(service);

    const result = await tool.execute(
      { query: 'gonartrose primaria', limit: 5 },
      baseContext,
    );

    expect(findByExactCode).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledWith('gonartrose primaria', 5);
    expect(result).toContain('Códigos CID');
    expect(result).toContain('M171');
    expect(result).toContain('Outras Gonartroses Primárias');
  });

  it('respeita limite máximo de 30 e mínimo de 1', async () => {
    const lookup = jest.fn().mockReturnValue([]);
    const service = makeCidService({ lookup });
    const [tool] = buildCidTools(service);

    await tool.execute({ query: 'gonartrose', limit: 999 }, baseContext);
    expect(lookup).toHaveBeenLastCalledWith('gonartrose', 30);

    await tool.execute({ query: 'gonartrose', limit: 0 }, baseContext);
    expect(lookup).toHaveBeenLastCalledWith('gonartrose', 1);
  });

  it('retorna mensagem amigável quando nada é encontrado', async () => {
    const service = makeCidService({
      lookup: jest.fn().mockReturnValue([]),
    });
    const [tool] = buildCidTools(service);

    const result = await tool.execute({ query: 'xyzwxyz' }, baseContext);

    expect(result).toContain('Nenhum CID encontrado');
    expect(result).toContain('xyzwxyz');
  });
});
