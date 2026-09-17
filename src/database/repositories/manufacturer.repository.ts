import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, ILike } from 'typeorm';
import { Manufacturer } from '../entities/manufacturer.entity';
import { BaseRepository } from './base.repository';
import { GENERIC_OPTION_NAME } from '../../shared/constants/generic-option';
import {
  mensagemDeGenericoBloqueado,
  violacaoDeUnicidade,
} from './unique-violation.util';

/** Índice que arbitra a corrida: uma linha genérica por conta. */
const INDICE_DO_GENERICO = 'uq_manufacturers_owner_generic';

@Injectable()
export class ManufacturerRepository extends BaseRepository<Manufacturer> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(Manufacturer));
  }

  findMany(
    where: FindOptionsWhere<Manufacturer> | FindOptionsWhere<Manufacturer>[],
    skip?: number,
    take?: number,
  ): Promise<Manufacturer[]> {
    return this.repository.find({
      where,
      skip,
      take,
      order: { name: 'ASC' },
    });
  }

  findByOwnerId(ownerId: string): Promise<Manufacturer[]> {
    return this.repository.find({
      where: { ownerId },
      order: { name: 'ASC' },
    });
  }

  /**
   * O fabricante genérico "Outro" da conta, criando-o se ainda não existir.
   *
   * Preguiçoso de propósito: conta nova não nasce com a linha, ela aparece na
   * primeira solicitação que precisar de um slot vazio. Duas requisições
   * simultâneas podem chegar aqui juntas — o índice único
   * `(owner_id) WHERE is_generic` derruba a segunda, que relê em vez de
   * insistir. Sem isso, a conta ficaria com dois "Outro".
   */
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

      // Violação de outro índice não é a corrida: a genérica não existe e não
      // vai aparecer numa releitura. Relançar o erro cru daqui esconderia o que
      // está acontecendo de verdade.
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

  findByNameIncludingDeleted(
    ownerId: string,
    name: string,
  ): Promise<Manufacturer | null> {
    const trimmed = name.trim();
    if (!trimmed) return Promise.resolve(null);

    return this.repository.findOne({
      where: { ownerId, name: ILike(trimmed) },
      withDeleted: true,
    });
  }
}
