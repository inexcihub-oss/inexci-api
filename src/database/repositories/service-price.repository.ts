import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ServicePrice } from '../entities/service-price.entity';
import { AppointmentType } from '../entities/appointment.entity';
import { BaseRepository } from './base.repository';

export interface CriterioDePreco {
  doctorId?: string | null;
  type?: AppointmentType | null;
}

export type PrecoCandidato = Pick<
  ServicePrice,
  'id' | 'doctorId' | 'appointmentType' | 'amount' | 'updatedAt'
>;

function especificidade(
  preco: PrecoCandidato,
  criterio: CriterioDePreco,
): number | null {
  const doutorCasa = preco.doctorId === null || preco.doctorId === undefined;
  const tipoCasa =
    preco.appointmentType === null || preco.appointmentType === undefined;

  if (!doutorCasa && preco.doctorId !== criterio.doctorId) return null;
  if (!tipoCasa && preco.appointmentType !== criterio.type) return null;

  if (!doutorCasa && !tipoCasa) return 0;
  if (!doutorCasa) return 1;
  if (!tipoCasa) return 2;
  return 3;
}

export function escolherPrecoMaisEspecifico<T extends PrecoCandidato>(
  candidatos: T[],
  criterio: CriterioDePreco,
): T | null {
  let escolhido: { preco: T; nivel: number } | null = null;
  for (const preco of candidatos) {
    const nivel = especificidade(preco, criterio);
    if (nivel === null) continue;
    if (
      !escolhido ||
      nivel < escolhido.nivel ||
      (nivel === escolhido.nivel &&
        new Date(preco.updatedAt).getTime() >
          new Date(escolhido.preco.updatedAt).getTime())
    ) {
      escolhido = { preco, nivel };
    }
  }
  return escolhido?.preco ?? null;
}

@Injectable()
export class ServicePriceRepository extends BaseRepository<ServicePrice> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(ServicePrice));
  }

  findByOwner(ownerId: string): Promise<ServicePrice[]> {
    return this.repository
      .createQueryBuilder('price')
      .leftJoin('price.doctor', 'doctor')
      .addSelect(['doctor.id', 'doctor.name'])
      .where('price.ownerId = :ownerId', { ownerId })
      .orderBy('price.active', 'DESC')
      .addOrderBy('price.description', 'ASC')
      .addOrderBy('price.id', 'ASC')
      .getMany();
  }

  findOwned(id: string, ownerId: string): Promise<ServicePrice | null> {
    return this.repository
      .createQueryBuilder('price')
      .leftJoin('price.doctor', 'doctor')
      .addSelect(['doctor.id', 'doctor.name'])
      .where('price.id = :id', { id })
      .andWhere('price.ownerId = :ownerId', { ownerId })
      .getOne();
  }

  async hardDelete(id: string, ownerId: string): Promise<void> {
    await this.repository.delete({ id, ownerId });
  }

  findCandidatos(
    ownerId: string,
    criterio: CriterioDePreco,
  ): Promise<PrecoCandidato[]> {
    const qb = this.repository
      .createQueryBuilder('price')
      .select([
        'price.id',
        'price.doctorId',
        'price.appointmentType',
        'price.amount',
        'price.updatedAt',
      ])
      .where('price.ownerId = :ownerId', { ownerId })
      .andWhere('price.active = true');

    if (criterio.doctorId) {
      qb.andWhere('(price.doctorId = :doctorId OR price.doctorId IS NULL)', {
        doctorId: criterio.doctorId,
      });
    } else {
      qb.andWhere('price.doctorId IS NULL');
    }

    if (criterio.type) {
      qb.andWhere(
        '(price.appointmentType = :type OR price.appointmentType IS NULL)',
        { type: criterio.type },
      );
    } else {
      qb.andWhere('price.appointmentType IS NULL');
    }

    return qb.getMany();
  }

  async resolvePrice(
    ownerId: string,
    criterio: CriterioDePreco,
  ): Promise<PrecoCandidato | null> {
    return escolherPrecoMaisEspecifico(
      await this.findCandidatos(ownerId, criterio),
      criterio,
    );
  }
}
