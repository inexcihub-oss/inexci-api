import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere } from 'typeorm';
import { Patient } from '../entities/patient.entity';
import { BaseRepository } from './base.repository';

/**
 * O que a listagem de pacientes precisa: as cinco colunas da tela `/pacientes`
 * mais os timestamps (o "há X dias" da tela de colaborador). Os seletores do
 * wizard e da agenda usam um subconjunto disto (nome e CPF).
 *
 * `Patient` não tem `@Exclude` em campo nenhum, então sem `select` a entidade
 * sai inteira — inclusive `medicalNotes`, que é dado clínico e não tem por que
 * trafegar numa listagem. Quem precisa do cadastro completo usa
 * `GET /patients/:id`, que passa pelo `auditProntuarioAccess`.
 */
const COLUNAS_DA_LISTAGEM = [
  'p.id',
  'p.name',
  'p.cpf',
  'p.email',
  'p.phone',
  'p.birthDate',
  'p.createdAt',
  'p.updatedAt',
];

@Injectable()
export class PatientRepository extends BaseRepository<Patient> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(Patient));
  }

  findMany(
    where: FindOptionsWhere<Patient> | FindOptionsWhere<Patient>[],
    skip?: number,
    take?: number,
  ): Promise<Patient[]> {
    return this.repository.find({
      where,
      skip,
      take,
      order: { name: 'ASC' },
    });
  }

  /**
   * Lista pacientes de um médico específico (paciente é do médico).
   */
  findByDoctorId(doctorId: string): Promise<Patient[]> {
    return this.repository.find({
      where: { doctorId },
      order: { name: 'ASC' },
    });
  }

  /**
   * Lista todos os pacientes da clínica (ownerId) — útil para visões de admin.
   */
  findByOwnerId(ownerId: string): Promise<Patient[]> {
    return this.repository.find({
      where: { ownerId },
      order: { name: 'ASC' },
    });
  }

  /**
   * Busca pacientes por nome usando ILIKE server-side (sem carregar todos em
   * memória). Usa `unaccent` do Postgres para correspondência insensível a
   * acentos — requer a extensão `unaccent` (habilitada por padrão na imagem
   * custom `docker/postgres/Dockerfile`).
   *
   * @param ownerId   Tenant da clínica.
   * @param search    Termo de busca (já normalizado ou raw).
   * @param mode      `contains` → `%name%`, `prefix` → `name%`, `exact` → `=`.
   * @param limit     Máximo de resultados retornados.
   */
  async findByNameIlike(
    ownerId: string,
    search: string,
    mode: 'contains' | 'prefix' | 'exact',
    limit: number,
  ): Promise<Patient[]> {
    const qb = this.repository
      .createQueryBuilder('p')
      .where('p.owner_id = :ownerId', { ownerId })
      .orderBy('p.name', 'ASC')
      .limit(limit);

    const term =
      mode === 'exact'
        ? search
        : mode === 'prefix'
          ? `${search}%`
          : `%${search}%`;

    if (mode === 'exact') {
      qb.andWhere('unaccent(lower(p.name)) = unaccent(lower(:term))', { term });
    } else {
      qb.andWhere('unaccent(lower(p.name)) ILIKE unaccent(lower(:term))', {
        term,
      });
    }

    return qb.getMany();
  }

  /**
   * Listagem paginada da tela de pacientes com busca server-side opcional por
   * nome (acento-insensível via `unaccent`), e-mail ou CPF. Retorna
   * `[registros, total]` num único round-trip (`getManyAndCount`), evitando o
   * carregamento da tabela inteira no navegador (P6/P7).
   */
  findAndCountWithSearch(
    ownerId: string,
    search: string | null | undefined,
    skip: number,
    take: number,
  ): Promise<[Patient[], number]> {
    const qb = this.repository
      .createQueryBuilder('p')
      .select(COLUNAS_DA_LISTAGEM)
      .where('p.owner_id = :ownerId', { ownerId })
      .orderBy('p.name', 'ASC')
      .skip(skip)
      .take(take);

    const trimmed = search?.trim();
    if (trimmed) {
      const term = `%${trimmed}%`;
      qb.andWhere(
        '(unaccent(lower(p.name)) ILIKE unaccent(lower(:term)) OR p.email ILIKE :term OR p.cpf ILIKE :term)',
        { term },
      );
    }

    return qb.getManyAndCount();
  }
}
