import { buildCatalogTools } from './catalog.tools';
import { ToolContext } from './tool.interface';

const baseContext = (): ToolContext => ({
  userId: 'user-1',
  phone: '+5511999999999',
  accessibleDoctorIds: ['doctor-1'],
  conversationId: 'conv-1',
  ownerId: 'owner-1',
});

function createTools(overrides: Partial<Record<string, any>> = {}) {
  const procedureRepo = {
    findOne: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    ...overrides.procedureRepo,
  };

  const tools = buildCatalogTools(procedureRepo as any);
  const map = new Map(tools.map((t) => [t.name, t]));
  return { procedureRepo, tools, map };
}

describe('CatalogTools', () => {
  describe('search_procedures', () => {
    it('retorna catálogo com IDs visíveis ao LLM', async () => {
      const { map, procedureRepo } = createTools();
      procedureRepo.findMany.mockResolvedValue([
        { id: 'proc-1', name: 'Artroscopia de Joelho' },
        { id: 'proc-2', name: 'Cirurgia do Joelho' },
        { id: 'proc-3', name: 'Cirurgia de Quadril' },
      ]);

      const result = await map
        .get('search_procedures')!
        .execute({ query: 'joelho' }, baseContext());

      expect(result).toContain('Artroscopia de Joelho');
      expect(result).toContain('id: proc-1');
      expect(result).toContain('Cirurgia do Joelho');
      expect(result).toContain('id: proc-2');
      expect(result).not.toContain('Quadril');
    });

    it('quando vazio sugere o fluxo de draft (plan_actions + procedure_draft)', async () => {
      const { map, procedureRepo } = createTools();
      procedureRepo.findMany.mockResolvedValue([
        { id: 'proc-1', name: 'Artroscopia de Quadril' },
      ]);

      const result = await map
        .get('search_procedures')!
        .execute({ query: 'joelho' }, baseContext());

      expect(result).toContain('Não encontrei');
      expect(result).toContain('joelho');
      expect(result).toContain('plan_actions');
      expect(result).toContain('procedure_draft');
    });

    it('sem query devolve as primeiras N entradas do catálogo', async () => {
      const { map, procedureRepo } = createTools();
      const fakes = Array.from({ length: 8 }).map((_, i) => ({
        id: `proc-${i}`,
        name: `Procedimento ${i}`,
      }));
      procedureRepo.findMany.mockResolvedValue(fakes);

      const result = await map
        .get('search_procedures')!
        .execute({ limit: 5 }, baseContext());

      expect(result).toContain('Procedimentos cirúrgicos do catálogo');
      expect(result).toContain('5 de 8');
      expect(result.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(
        5,
      );
    });
  });
});
