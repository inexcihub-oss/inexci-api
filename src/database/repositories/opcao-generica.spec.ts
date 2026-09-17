import { SupplierRepository } from './supplier.repository';
import { ManufacturerRepository } from './manufacturer.repository';
import { GENERIC_OPTION_NAME } from '../../shared/constants/generic-option';

/**
 * "Outro" é criado sob demanda: conta nova não nasce com ele, e a primeira
 * solicitação que precisar de um slot vazio o cria. Como duas requisições
 * simultâneas podem tentar criar ao mesmo tempo, o índice único
 * `(owner_id) WHERE is_generic` é quem arbitra — a segunda toma violação e
 * relê, em vez de criar uma segunda linha genérica.
 */
describe.each([
  ['SupplierRepository', SupplierRepository, 'uq_suppliers_owner_generic'],
  [
    'ManufacturerRepository',
    ManufacturerRepository,
    'uq_manufacturers_owner_generic',
  ],
])('%s.ensureGeneric', (_nome, Repositorio, indiceDoGenerico) => {
  function montar(typeOrmRepository: Record<string, unknown>) {
    const dataSource = { getRepository: () => typeOrmRepository };
    return new (Repositorio as new (ds: unknown) => {
      ensureGeneric(ownerId: string): Promise<{ id: string }>;
    })(dataSource);
  }

  it('devolve a linha genérica existente sem criar outra', async () => {
    const existente = { id: 'gen-1', ownerId: 'owner-1', isGeneric: true };
    const save = jest.fn();
    const repositorio = montar({
      findOne: jest.fn().mockResolvedValue(existente),
      create: jest.fn(),
      save,
    });

    await expect(repositorio.ensureGeneric('owner-1')).resolves.toBe(existente);
    expect(save).not.toHaveBeenCalled();
  });

  it('cria a linha genérica na primeira vez, com o nome padrão', async () => {
    const criada = { id: 'gen-1' };
    const create = jest.fn().mockReturnValue(criada);
    const save = jest.fn().mockResolvedValue(criada);
    const repositorio = montar({
      findOne: jest.fn().mockResolvedValue(null),
      create,
      save,
    });

    await expect(repositorio.ensureGeneric('owner-1')).resolves.toBe(criada);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'owner-1',
        isGeneric: true,
        name: GENERIC_OPTION_NAME,
      }),
    );
  });

  function violacao(constraint?: string, dentroDeDriverError = false) {
    const detalhe = { code: '23505', constraint };
    return dentroDeDriverError
      ? Object.assign(new Error('duplicate key'), { driverError: detalhe })
      : Object.assign(new Error('duplicate key'), detalhe);
  }

  it('relê em vez de propagar quando outra requisição criou antes', async () => {
    const criadaPelaOutra = { id: 'gen-1' };
    const findOne = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(criadaPelaOutra);
    const repositorio = montar({
      findOne,
      create: jest.fn().mockReturnValue({}),
      save: jest.fn().mockRejectedValue(violacao(indiceDoGenerico)),
    });

    await expect(repositorio.ensureGeneric('owner-1')).resolves.toBe(
      criadaPelaOutra,
    );
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  /**
   * Nem toda violação de unicidade aqui é a corrida entre duas requisições.
   * Em `manufacturers`, `uq_manufacturers_owner_name_active` protege
   * `(owner_id, LOWER(name))` — uma linha legada chamada "Outro" que nunca foi
   * unificada derruba o insert por esse outro índice. Tratá-la como corrida
   * fazia o método reler, não achar nada e relançar o erro cru do Postgres, que
   * não diz o que aconteceu nem o que fazer.
   */
  it('não confunde colisão de nome com a corrida entre requisições', async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    const repositorio = montar({
      findOne,
      create: jest.fn().mockReturnValue({}),
      save: jest
        .fn()
        .mockRejectedValue(violacao('uq_manufacturers_owner_name_active')),
    });

    await expect(repositorio.ensureGeneric('owner-1')).rejects.toThrow(
      /outro-generico-aplicar\.sql/,
    );
    // Não vale relê-la: a linha genérica não existe e não vai aparecer.
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it('nomeia a conta e o índice violado na mensagem', async () => {
    const repositorio = montar({
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockReturnValue({}),
      save: jest
        .fn()
        .mockRejectedValue(violacao('uq_manufacturers_owner_name_active')),
    });

    const erro = await repositorio
      .ensureGeneric('owner-1')
      .catch((e: Error) => e);

    expect((erro as Error).message).toContain('owner-1');
    expect((erro as Error).message).toContain(
      'uq_manufacturers_owner_name_active',
    );
  });

  /** O TypeORM embrulha o erro do driver; a constraint fica lá dentro. */
  it('lê a constraint também de dentro de driverError', async () => {
    const repositorio = montar({
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockReturnValue({}),
      save: jest
        .fn()
        .mockRejectedValue(
          violacao('uq_manufacturers_owner_name_active', true),
        ),
    });

    await expect(repositorio.ensureGeneric('owner-1')).rejects.toThrow(
      /outro-generico-aplicar\.sql/,
    );
  });

  it('propaga erro que não seja de chave duplicada', async () => {
    const repositorio = montar({
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockReturnValue({}),
      save: jest.fn().mockRejectedValue(new Error('conexão perdida')),
    });

    await expect(repositorio.ensureGeneric('owner-1')).rejects.toThrow(
      'conexão perdida',
    );
  });
});
