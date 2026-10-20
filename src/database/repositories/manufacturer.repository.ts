import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Manufacturer } from '../entities/manufacturer.entity';
import { OwnedCatalogRepository } from './owned-catalog.repository';
import { GENERIC_OPTION_NAME } from '../../shared/constants/generic-option';
import {
  mensagemDeGenericoBloqueado,
  violacaoDeUnicidade,
} from './unique-violation.util';

const INDICE_DO_GENERICO = 'uq_manufacturers_owner_generic';

@Injectable()
export class ManufacturerRepository extends OwnedCatalogRepository<Manufacturer> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(Manufacturer));
  }

  async ensureGeneric(ownerId: string): Promise<Manufacturer> {
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
            'fabricante',
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
