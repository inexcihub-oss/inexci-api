import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  PaymentMethod,
  PaymentMethodConfig,
} from '../entities/payment-method-config.entity';
import { BaseRepository } from './base.repository';

export interface NovaConfiguracaoDeForma {
  method: PaymentMethod;
  active: boolean;
  maxInstallments: number;
  defaultAccountId: string | null;
}

@Injectable()
export class PaymentMethodConfigRepository extends BaseRepository<PaymentMethodConfig> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(PaymentMethodConfig));
  }

  findByOwnerWithAccount(ownerId: string): Promise<PaymentMethodConfig[]> {
    return this.repository.find({
      where: { ownerId },
      relations: { defaultAccount: true },
    });
  }

  findOwnedByMethod(
    ownerId: string,
    method: PaymentMethod,
  ): Promise<PaymentMethodConfig | null> {
    return this.repository.findOne({
      where: { ownerId, method },
      relations: { defaultAccount: true },
    });
  }

  async insertMissing(
    ownerId: string,
    createdById: string | null,
    configuracoes: NovaConfiguracaoDeForma[],
  ): Promise<void> {
    if (configuracoes.length === 0) return;
    await this.repository
      .createQueryBuilder()
      .insert()
      .into(PaymentMethodConfig)
      .values(
        configuracoes.map((configuracao) => ({
          ownerId,
          createdById,
          method: configuracao.method,
          active: configuracao.active,
          maxInstallments: configuracao.maxInstallments,
          defaultAccountId: configuracao.defaultAccountId,
        })),
      )
      .orIgnore()
      .execute();
  }

  save(config: PaymentMethodConfig): Promise<PaymentMethodConfig> {
    return this.repository.save(config);
  }
}
