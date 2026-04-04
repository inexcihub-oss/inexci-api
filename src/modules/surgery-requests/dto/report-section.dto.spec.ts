import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateReportSectionDto } from './create-report-section.dto';
import { UpdateReportSectionDto } from './update-report-section.dto';
import { ReorderReportSectionsDto } from './reorder-report-sections.dto';

/**
 * PRD: Reformulação Laudos — US-001 / US-002
 * Testa validação dos DTOs de seções de laudo.
 */
describe('CreateReportSectionDto', () => {
  it('deve validar com title obrigatório', async () => {
    const dto = plainToInstance(CreateReportSectionDto, {
      title: 'Histórico Clínico',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve aceitar title + description', async () => {
    const dto = plainToInstance(CreateReportSectionDto, {
      title: 'Conduta',
      description: '<p>Texto do laudo em HTML</p>',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve falhar sem title', async () => {
    const dto = plainToInstance(CreateReportSectionDto, {
      description: 'Conteúdo sem título',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === 'title')).toBeDefined();
  });

  it('deve falhar com title vazio', async () => {
    const dto = plainToInstance(CreateReportSectionDto, {
      title: '',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('deve falhar se title não for string', async () => {
    const dto = plainToInstance(CreateReportSectionDto, {
      title: 123,
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('UpdateReportSectionDto', () => {
  it('deve validar sem nenhum campo (tudo opcional)', async () => {
    const dto = plainToInstance(UpdateReportSectionDto, {});

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve aceitar somente title', async () => {
    const dto = plainToInstance(UpdateReportSectionDto, {
      title: 'Novo Título',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve aceitar somente description', async () => {
    const dto = plainToInstance(UpdateReportSectionDto, {
      description: '<p>Conteúdo atualizado</p>',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve aceitar title + description', async () => {
    const dto = plainToInstance(UpdateReportSectionDto, {
      title: 'Diagnóstico',
      description: '<p>Novo diagnóstico</p>',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve falhar se title não for string', async () => {
    const dto = plainToInstance(UpdateReportSectionDto, {
      title: 999,
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('ReorderReportSectionsDto', () => {
  it('deve validar com array de IDs (strings)', async () => {
    const dto = plainToInstance(ReorderReportSectionsDto, {
      ids: ['uuid-1', 'uuid-2', 'uuid-3'],
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve falhar sem ids', async () => {
    const dto = plainToInstance(ReorderReportSectionsDto, {});

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('deve falhar se ids não for array', async () => {
    const dto = plainToInstance(ReorderReportSectionsDto, {
      ids: 'not-an-array',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('deve falhar se ids contém valores não-string', async () => {
    const dto = plainToInstance(ReorderReportSectionsDto, {
      ids: [1, 2, 3],
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('deve aceitar array vazio', async () => {
    const dto = plainToInstance(ReorderReportSectionsDto, {
      ids: [],
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
