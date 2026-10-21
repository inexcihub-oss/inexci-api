import { BadRequestException, Injectable } from '@nestjs/common';
import {
  MAX_INSTALLMENTS_LIMIT,
  PAYMENT_METHODS,
  PAYMENT_METHODS_ATIVOS_POR_PADRAO,
  PaymentMethod,
  PaymentMethodConfig,
} from 'src/database/entities/payment-method-config.entity';
import { PaymentMethodConfigRepository } from 'src/database/repositories/payment-method-config.repository';
import {
  PaymentMethodConfigDto,
  UpdatePaymentMethodConfigDto,
} from '../dto/payment-method-config.dto';
import { FinancialAccountsService } from './financial-accounts.service';

export const PARCELAS_SO_NO_CREDITO =
  'Parcelamento só é permitido no cartão de crédito';
export const PARCELAS_FORA_DO_LIMITE = `O número de parcelas deve estar entre 1 e ${MAX_INSTALLMENTS_LIMIT}`;

@Injectable()
export class PaymentMethodConfigsService {
  constructor(
    private readonly configRepository: PaymentMethodConfigRepository,
    private readonly accountsService: FinancialAccountsService,
  ) {}

  async list(
    ownerId: string,
    userId: string,
  ): Promise<PaymentMethodConfigDto[]> {
    const configuracoes = await this.ensureDefaults(ownerId, userId);
    return configuracoes.map((configuracao) => this.toDto(configuracao));
  }

  async update(
    ownerId: string,
    userId: string,
    method: PaymentMethod,
    dto: UpdatePaymentMethodConfigDto,
  ): Promise<PaymentMethodConfigDto> {
    this.assertParcelas(method, dto.maxInstallments);

    const conta = dto.defaultAccountId
      ? await this.accountsService.findActiveOwnedOrFail(
          ownerId,
          dto.defaultAccountId,
        )
      : null;

    const configuracoes = await this.ensureDefaults(ownerId, userId);
    const configuracao = configuracoes.find((c) => c.method === method);
    if (!configuracao) {
      throw new BadRequestException('Forma de pagamento inválida');
    }

    configuracao.active = dto.active;
    configuracao.maxInstallments = dto.maxInstallments;
    configuracao.defaultAccountId = conta?.id ?? null;
    configuracao.defaultAccount = conta;
    configuracao.updatedById = userId;

    const salva = await this.configRepository.save(configuracao);
    salva.defaultAccount = conta;
    return this.toDto(salva);
  }

  private assertParcelas(method: PaymentMethod, maxInstallments: number): void {
    if (
      !Number.isInteger(maxInstallments) ||
      maxInstallments < 1 ||
      maxInstallments > MAX_INSTALLMENTS_LIMIT
    ) {
      throw new BadRequestException(PARCELAS_FORA_DO_LIMITE);
    }
    if (maxInstallments > 1 && method !== PaymentMethod.CREDIT_CARD) {
      throw new BadRequestException(PARCELAS_SO_NO_CREDITO);
    }
  }

  private async ensureDefaults(
    ownerId: string,
    userId: string,
  ): Promise<PaymentMethodConfig[]> {
    let configuracoes =
      await this.configRepository.findByOwnerWithAccount(ownerId);
    const existentes = new Set(configuracoes.map((c) => c.method));
    const faltantes = PAYMENT_METHODS.filter((m) => !existentes.has(m));

    if (faltantes.length > 0) {
      await this.configRepository.insertMissing(
        ownerId,
        userId,
        faltantes.map((method) => ({
          method,
          active: PAYMENT_METHODS_ATIVOS_POR_PADRAO.includes(method),
          maxInstallments: 1,
          defaultAccountId: null,
        })),
      );
      configuracoes =
        await this.configRepository.findByOwnerWithAccount(ownerId);
    }

    return [...configuracoes].sort(
      (a, b) =>
        PAYMENT_METHODS.indexOf(a.method) - PAYMENT_METHODS.indexOf(b.method),
    );
  }

  private toDto(configuracao: PaymentMethodConfig): PaymentMethodConfigDto {
    const conta = configuracao.defaultAccount ?? null;
    return {
      method: configuracao.method,
      active: configuracao.active,
      defaultAccountId: configuracao.defaultAccountId ?? null,
      defaultAccount: conta ? { id: conta.id, name: conta.name } : null,
      maxInstallments: configuracao.maxInstallments,
    };
  }
}
