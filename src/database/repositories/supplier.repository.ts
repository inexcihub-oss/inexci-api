import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Supplier } from '../entities/supplier.entity';
import { OwnedCatalogRepository } from './owned-catalog.repository';
import { GENERIC_OPTION_NAME } from '../../shared/constants/generic-option';
import {
  mensagemDeGenericoBloqueado,
  violacaoDeUnicidade,
} from './unique-violation.util';

const INDICE_DO_GENERICO = 'uq_suppliers_owner_generic';

@Injectable()
export class SupplierRepository extends OwnedCatalogRepository<Supplier> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(Supplier));
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
}
