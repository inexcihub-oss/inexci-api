import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, ILike } from 'typeorm';
import { Supplier } from '../entities/supplier.entity';
import { BaseRepository } from './base.repository';
import { GENERIC_OPTION_NAME } from '../../shared/constants/generic-option';
import {
  mensagemDeGenericoBloqueado,
  violacaoDeUnicidade,
} from './unique-violation.util';

const INDICE_DO_GENERICO = 'uq_suppliers_owner_generic';

@Injectable()
export class SupplierRepository extends BaseRepository<Supplier> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(Supplier));
  }

  findMany(
    where: FindOptionsWhere<Supplier> | FindOptionsWhere<Supplier>[],
    skip?: number,
    take?: number,
  ): Promise<Supplier[]> {
    return this.repository.find({
      where,
      skip,
      take,
      order: { name: 'ASC' },
    });
  }

  findByOwnerId(ownerId: string): Promise<Supplier[]> {
    return this.repository.find({
      where: { ownerId },
      order: { name: 'ASC' },
    });
  }

  findByIdWithQuotations(id: string): Promise<Supplier | null> {
    return this.repository.findOne({
      where: { id },
      relations: [
        'quotations',
        'quotations.surgeryRequest',
        'quotations.surgeryRequest.patient',
      ],
      order: { quotations: { createdAt: 'DESC' } },
    });
  }

  async ensureGeneric(ownerId: string): Promise<Supplier> {
    const existente = await this.repository.findOne({
      where: { ownerId, isGeneric: true },
    });
    if (existente) return existente;

    try {
      return await this.repository.save(
        this.repository.create({
          ownerId,
          isGeneric: true,
          name: GENERIC_OPTION_NAME,
        }),
      );
    } catch (erro) {
      const violacao = violacaoDeUnicidade(erro);
      if (!violacao) throw erro;

      if (violacao.constraint && violacao.constraint !== INDICE_DO_GENERICO) {
        throw new Error(
          mensagemDeGenericoBloqueado(
            'fornecedor',
            ownerId,
            violacao.constraint,
          ),
        );
      }

      const criadoPelaOutra = await this.repository.findOne({
        where: { ownerId, isGeneric: true },
      });
      if (!criadoPelaOutra) throw erro;
      return criadoPelaOutra;
    }
  }

  findByNameIncludingDeleted(
    ownerId: string,
    name: string,
  ): Promise<Supplier | null> {
    const trimmed = name.trim();
    if (!trimmed) return Promise.resolve(null);

    return this.repository.findOne({
      where: { ownerId, name: ILike(trimmed) },
      withDeleted: true,
    });
  }
}
