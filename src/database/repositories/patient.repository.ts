import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere } from 'typeorm';
import { Patient } from '../entities/patient.entity';
import { BaseRepository } from './base.repository';

const COLUNAS_DA_LISTAGEM = [
  'p.id',
  'p.name',
  'p.cpf',
  'p.email',
  'p.phone',
  'p.photoPath',
  'p.healthPlanId',
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

  findByDoctorId(doctorId: string): Promise<Patient[]> {
    return this.repository.find({
      where: { doctorId },
      order: { name: 'ASC' },
    });
  }

  findByOwnerId(ownerId: string): Promise<Patient[]> {
    return this.repository.find({
      where: { ownerId },
      order: { name: 'ASC' },
    });
  }

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
