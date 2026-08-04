import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { FindManySharedDto } from './find-many.dto';
import { PAGINATION_DEFAULTS } from 'src/shared/constants/pagination';

describe('FindManySharedDto', () => {
  function transform(payload: Record<string, unknown>) {
    // Reproduz o ValidationPipe global (transform: true).
    return plainToInstance(FindManySharedDto, payload, {
      enableImplicitConversion: false,
    });
  }

  it('aplica os defaults de paginação quando skip/take estão ausentes', () => {
    const dto = transform({});

    expect(dto.skip).toBe(PAGINATION_DEFAULTS.SKIP);
    expect(dto.take).toBe(PAGINATION_DEFAULTS.TAKE);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('coage strings de query string para número', () => {
    const dto = transform({ skip: '20', take: '50' });

    expect(dto.skip).toBe(20);
    expect(dto.take).toBe(50);
    expect(typeof dto.skip).toBe('number');
    expect(typeof dto.take).toBe('number');
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('honra valores explícitos altos (ex.: telas que carregam tudo)', () => {
    // O frontend usa FETCH_ALL_TAKE=1000 (lib/api.ts) em varios seletores
    // (pacientes, convenios, hospitais, etc.) — sem a asserção de
    // validateSync aqui, um teto abaixo de 1000 quebraria essas telas em
    // produção sem que este teste acusasse nada (regressão real ja
    // observada: MAX_TAKE=200 rejeitava exatamente este valor com 400).
    const dto = transform({ take: '1000' });

    expect(dto.skip).toBe(PAGINATION_DEFAULTS.SKIP);
    expect(dto.take).toBe(1000);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejeita take menor que 1 e skip negativo', () => {
    const dto = transform({ skip: '-1', take: '0' });

    const errors = validateSync(dto);
    const props = errors.map((e) => e.property);
    expect(props).toContain('skip');
    expect(props).toContain('take');
  });

  it('recusa take acima do teto', () => {
    const dto = plainToInstance(FindManySharedDto, { take: 1_000_000 });
    const erros = validateSync(dto);
    expect(erros.length).toBeGreaterThan(0);
  });

  it('recusa take logo acima do teto (1001)', () => {
    const dto = plainToInstance(FindManySharedDto, { take: 1001 });
    const erros = validateSync(dto);
    expect(erros.length).toBeGreaterThan(0);
  });

  it('aceita take dentro do teto', () => {
    const dto = plainToInstance(FindManySharedDto, { take: 100 });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('aceita take exatamente no teto (1000, usado por FETCH_ALL_TAKE do frontend)', () => {
    const dto = plainToInstance(FindManySharedDto, { take: PAGINATION_DEFAULTS.MAX_TAKE });
    expect(validateSync(dto)).toHaveLength(0);
  });
});
