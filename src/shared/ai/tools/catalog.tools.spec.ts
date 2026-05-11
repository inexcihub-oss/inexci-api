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
  const hospitalRepo = {
    findOne: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    ...overrides.hospitalRepo,
  };
  const healthPlanRepo = {
    findOne: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    ...overrides.healthPlanRepo,
  };
  const procedureRepo = {
    findOne: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    ...overrides.procedureRepo,
  };
  const userRepo = {
    findOne: jest.fn(),
    ...overrides.userRepo,
  };

  const tools = buildCatalogTools(
    hospitalRepo as any,
    healthPlanRepo as any,
    procedureRepo as any,
    userRepo as any,
  );
  const map = new Map(tools.map((t) => [t.name, t]));
  return { hospitalRepo, healthPlanRepo, procedureRepo, userRepo, tools, map };
}

describe('CatalogTools', () => {
  describe('create_hospital', () => {
    it('valida nome obrigatório', async () => {
      const { map } = createTools();
      const result = await map
        .get('create_hospital')!
        .execute({ name: ' ', confirm: true }, baseContext());
      expect(result).toMatch(/`name`/);
    });

    it('mostra preview quando confirm não foi passado', async () => {
      const { map, hospitalRepo } = createTools();
      hospitalRepo.findOne.mockResolvedValue(null);
      hospitalRepo.findMany.mockResolvedValue([]);

      const result = await map
        .get('create_hospital')!
        .execute({ name: 'Hospital Albert Einstein' }, baseContext());

      expect(result).toMatch(/Confirme/);
      expect(hospitalRepo.create).not.toHaveBeenCalled();
    });

    it('detecta hospital já existente (com nome normalizado)', async () => {
      const { map, hospitalRepo } = createTools();
      hospitalRepo.findOne.mockResolvedValue(null);
      hospitalRepo.findMany.mockResolvedValue([
        { id: 'h-1', name: 'Hospital Albert Einstein' },
      ]);

      const result = await map
        .get('create_hospital')!
        .execute(
          { name: 'hospital albert einstein', confirm: true },
          baseContext(),
        );

      expect(result).toMatch(/já existe/i);
      expect(hospitalRepo.create).not.toHaveBeenCalled();
    });

    it('cadastra hospital quando confirm=true e ainda não existe', async () => {
      const { map, hospitalRepo } = createTools();
      hospitalRepo.findOne.mockResolvedValue(null);
      hospitalRepo.findMany.mockResolvedValue([]);
      hospitalRepo.create.mockResolvedValue({
        id: 'h-novo',
        name: 'Hospital Sírio-Libanês',
      });

      const result = await map
        .get('create_hospital')!
        .execute(
          { name: 'Hospital Sírio-Libanês', confirm: true },
          baseContext(),
        );

      expect(hospitalRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'owner-1',
          name: 'Hospital Sírio-Libanês',
          active: true,
        }),
      );
      expect(result).toMatch(/cadastrado/i);
    });

    it('falha quando não consegue resolver ownerId', async () => {
      const { map } = createTools();
      const ctx = baseContext();
      ctx.ownerId = null;

      const result = await map
        .get('create_hospital')!
        .execute({ name: 'Hospital X', confirm: true }, ctx);

      expect(result).toMatch(/cl[íi]nica/i);
    });
  });

  describe('create_health_plan', () => {
    it('só precisa do nome (sem phone/email) — regressão da tool antiga', async () => {
      const { map, healthPlanRepo } = createTools();
      healthPlanRepo.findOne.mockResolvedValue(null);
      healthPlanRepo.findMany.mockResolvedValue([]);
      healthPlanRepo.create.mockResolvedValue({ id: 'hp-1', name: 'Unimed' });

      const result = await map
        .get('create_health_plan')!
        .execute({ name: 'Unimed', confirm: true }, baseContext());

      expect(healthPlanRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'owner-1',
          name: 'Unimed',
          active: true,
        }),
      );
      expect(result).toMatch(/cadastrado/i);
    });

    it('detecta convênio já cadastrado por nome normalizado', async () => {
      const { map, healthPlanRepo } = createTools();
      healthPlanRepo.findOne.mockResolvedValue(null);
      healthPlanRepo.findMany.mockResolvedValue([
        { id: 'hp-1', name: 'Unimed' },
      ]);

      const result = await map
        .get('create_health_plan')!
        .execute({ name: 'UNIMED ', confirm: true }, baseContext());

      expect(result).toMatch(/já existe/i);
      expect(healthPlanRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('create_procedure', () => {
    it('cadastra procedimento global quando ainda não existe', async () => {
      const { map, procedureRepo } = createTools();
      procedureRepo.findOne.mockResolvedValue(null);
      procedureRepo.findMany.mockResolvedValue([]);
      procedureRepo.create.mockResolvedValue({
        id: 'proc-1',
        name: 'Cirurgia no joelho',
      });

      const result = await map
        .get('create_procedure')!
        .execute({ name: 'Cirurgia no joelho', confirm: true }, baseContext());

      expect(procedureRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Cirurgia no joelho' }),
      );
      expect(result).toMatch(/cadastrado/i);
    });

    it('detecta procedimento equivalente já cadastrado (acento/caixa)', async () => {
      const { map, procedureRepo } = createTools();
      procedureRepo.findOne.mockResolvedValue(null);
      procedureRepo.findMany.mockResolvedValue([
        { id: 'proc-99', name: 'Artroscopia de Joelho' },
      ]);

      const result = await map
        .get('create_procedure')!
        .execute(
          { name: 'artroscopia de joelho', confirm: true },
          baseContext(),
        );

      expect(result).toMatch(/já existe/i);
      expect(procedureRepo.create).not.toHaveBeenCalled();
    });

    it('rejeita nome vazio ou curto demais', async () => {
      const { map, procedureRepo } = createTools();
      procedureRepo.findOne.mockResolvedValue(null);
      procedureRepo.findMany.mockResolvedValue([]);

      const result = await map
        .get('create_procedure')!
        .execute({ name: 'A', confirm: true }, baseContext());

      expect(result).toMatch(/`name`/);
      expect(procedureRepo.create).not.toHaveBeenCalled();
    });
  });

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

      // Procedimentos cirúrgicos com substring "joelho" devem aparecer com id.
      expect(result).toContain('Artroscopia de Joelho');
      expect(result).toContain('id: proc-1');
      expect(result).toContain('Cirurgia do Joelho');
      expect(result).toContain('id: proc-2');
      // Procedimento sem joelho não aparece.
      expect(result).not.toContain('Quadril');
    });

    it('quando vazio sugere create_procedure', async () => {
      const { map, procedureRepo } = createTools();
      procedureRepo.findMany.mockResolvedValue([
        { id: 'proc-1', name: 'Artroscopia de Quadril' },
      ]);

      const result = await map
        .get('search_procedures')!
        .execute({ query: 'joelho' }, baseContext());

      expect(result).toContain('Não encontrei');
      expect(result).toContain('joelho');
      expect(result).toContain('create_procedure');
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
