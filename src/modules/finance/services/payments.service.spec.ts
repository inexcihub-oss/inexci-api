import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Permission } from 'src/shared/permissions';
import {
  FinancialEntryDirection,
  FinancialEntryKind,
} from 'src/database/entities/financial-entry.entity';
import { PaymentMethod } from 'src/database/entities/payment-method-config.entity';
import { ReceivableStatus } from 'src/database/entities/receivable.entity';
import { RefundReason } from 'src/database/entities/refund.entity';
import { UserRole } from 'src/database/entities/user.entity';
import { ReceivableRepository } from 'src/database/repositories/receivable.repository';
import {
  CONTA_BANCO,
  CONTA_CAIXA,
  CONTA_DE_FORA,
  CONTA_STONE,
  OUTRO_OWNER,
  OWNER,
  PACIENTE,
  RECEPCAO,
  SECRETARIA,
  ServicosFinanceiros,
  montarServicos,
} from './finance-fakes.helper-spec';
import { CONTA_INATIVA } from './financial-accounts.service';
import { PARCELAS_SO_NO_CREDITO } from './payment-method-configs.service';
import {
  CHAVE_DE_OUTRA_COBRANCA,
  DINHEIRO_ANTES_DA_ABERTURA,
  DINHEIRO_SEM_CAIXA,
  PAGAMENTO_ACIMA_DO_SALDO,
} from './payments.service';
import {
  DATA_NO_FUTURO,
  DATA_RETROATIVA_DEMAIS,
} from '../utils/data-do-lancamento';
import { COBRANCA_CANCELADA } from './receivables.service';
import {
  ESTORNO_ACIMA_DO_PAGO,
  ESTORNO_EM_DINHEIRO_SEM_CAIXA,
} from './refunds.service';

describe('PaymentsService e RefundsService', () => {
  let s: ServicosFinanceiros;
  let cobrancaId: string;

  beforeEach(async () => {
    s = montarServicos();
    const cobranca = await s.receivables.create(OWNER, RECEPCAO, {
      patientId: PACIENTE,
      items: [{ description: 'Consulta', unitAmount: '300.00' }],
    });
    cobrancaId = cobranca.id;
  });

  function abrirCaixa(userId = RECEPCAO, openingAmount = '100.00') {
    return s.cashSessions.open(OWNER, userId, {
      accountId: CONTA_CAIXA,
      openingAmount,
    });
  }

  describe('register', () => {
    it('pagamento dividido em PIX e crédito parcelado quita a cobrança', async () => {
      const paga = await s.payments.register(OWNER, RECEPCAO, cobrancaId, {
        lines: [
          { method: PaymentMethod.PIX, amount: '150.00' },
          {
            method: PaymentMethod.CREDIT_CARD,
            amount: '150.00',
            installments: 3,
            cardBrand: 'Visa',
            nsu: '123',
          },
        ],
      });
      expect(paga.status).toBe(ReceivableStatus.PAID);
      expect(paga.paidAmount).toBe('300.00');
      expect(paga.balance).toBe('0.00');
      expect(paga.payments).toHaveLength(2);
      expect(paga.payments[1]).toMatchObject({
        installments: 3,
        cardBrand: 'Visa',
        account: { id: CONTA_STONE },
        receivedBy: { id: RECEPCAO },
      });
      expect(
        s.banco.lancamentos.map((l) => [l.accountId, l.direction, l.amount]),
      ).toEqual([
        [CONTA_BANCO, FinancialEntryDirection.IN, '150.00'],
        [CONTA_STONE, FinancialEntryDirection.IN, '150.00'],
      ]);
    });

    it('pagamento parcial deixa a cobrança parcial', async () => {
      const parcial = await s.payments.register(OWNER, RECEPCAO, cobrancaId, {
        lines: [{ method: PaymentMethod.PIX, amount: '100.00' }],
      });
      expect(parcial.status).toBe(ReceivableStatus.PARTIAL);
      expect(parcial.balance).toBe('200.00');
    });

    it('recusa pagamento acima do saldo devedor', async () => {
      await expect(
        s.payments.register(OWNER, RECEPCAO, cobrancaId, {
          lines: [
            { method: PaymentMethod.PIX, amount: '200.00' },
            { method: PaymentMethod.PIX, amount: '100.01' },
          ],
        }),
      ).rejects.toThrow(PAGAMENTO_ACIMA_DO_SALDO);
      expect(s.banco.pagamentos).toHaveLength(0);
    });

    it('dois pagamentos simultâneos: a trava na cobrança faz o segundo recusar', async () => {
      const resultados = await Promise.allSettled([
        s.payments.register(OWNER, RECEPCAO, cobrancaId, {
          lines: [{ method: PaymentMethod.PIX, amount: '200.00' }],
        }),
        s.payments.register(OWNER, SECRETARIA, cobrancaId, {
          lines: [{ method: PaymentMethod.PIX, amount: '200.00' }],
        }),
      ]);
      expect(resultados.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      const recusa = resultados.find(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(recusa?.reason).toBeInstanceOf(BadRequestException);
      expect((recusa?.reason as Error).message).toBe(PAGAMENTO_ACIMA_DO_SALDO);
      expect(s.banco.pagamentos).toHaveLength(1);
      expect(s.banco.cobrancas[0].paidAmount).toBe('200.00');
      expect(s.banco.travasAtivas).toBe(0);
    });

    it('sem a trava as duas baixas passariam (prova que o teste de concorrência depende do FOR UPDATE)', async () => {
      const repo = (
        s.receivables as unknown as {
          receivableRepository: ReceivableRepository;
        }
      ).receivableRepository;
      repo.lockOwned = (id, ownerId) => repo.findOwned(id, ownerId);
      await Promise.allSettled([
        s.payments.register(OWNER, RECEPCAO, cobrancaId, {
          lines: [{ method: PaymentMethod.PIX, amount: '200.00' }],
        }),
        s.payments.register(OWNER, SECRETARIA, cobrancaId, {
          lines: [{ method: PaymentMethod.PIX, amount: '200.00' }],
        }),
      ]);
      expect(s.banco.pagamentos).toHaveLength(2);
    });

    it('dinheiro sem caixa aberto dá 400 e não grava nada', async () => {
      await expect(
        s.payments.register(OWNER, RECEPCAO, cobrancaId, {
          lines: [
            { method: PaymentMethod.PIX, amount: '100.00' },
            { method: PaymentMethod.CASH, amount: '100.00' },
          ],
        }),
      ).rejects.toThrow(DINHEIRO_SEM_CAIXA);
      expect(s.banco.pagamentos).toHaveLength(0);
      expect(s.banco.lancamentos).toHaveLength(0);
    });

    it('dinheiro entra no caixa; as outras formas entram na conta e ficam ligadas ao caixa', async () => {
      const caixa = await abrirCaixa();
      const paga = await s.payments.register(OWNER, RECEPCAO, cobrancaId, {
        lines: [
          { method: PaymentMethod.CASH, amount: '100.00' },
          { method: PaymentMethod.PIX, amount: '200.00' },
        ],
      });
      expect(paga.payments[0]).toMatchObject({
        method: PaymentMethod.CASH,
        cashSessionId: caixa.id,
        account: { id: CONTA_CAIXA },
      });
      expect(paga.payments[1]).toMatchObject({
        cashSessionId: caixa.id,
        account: { id: CONTA_BANCO },
      });
      const doPagamento = s.banco.lancamentos.filter(
        (l) => l.kind === FinancialEntryKind.PAYMENT,
      );
      expect(doPagamento.map((l) => [l.cashSessionId, l.accountId])).toEqual([
        [caixa.id, null],
        [null, CONTA_BANCO],
      ]);
      expect(s.banco.saldoDoCaixa(caixa.id)).toBe('200.00');
    });

    it('repetição com a mesma chave devolve o pagamento existente sem duplicar', async () => {
      const chave = '7b1c2a3e-4d5f-4a6b-8c7d-9e0f1a2b3c4d';
      const dto = {
        idempotencyKey: chave,
        lines: [
          { method: PaymentMethod.PIX, amount: '100.00' },
          { method: PaymentMethod.DEBIT_CARD, amount: '50.00' },
        ],
      };
      const primeira = await s.payments.register(
        OWNER,
        RECEPCAO,
        cobrancaId,
        dto,
      );
      const segunda = await s.payments.register(
        OWNER,
        RECEPCAO,
        cobrancaId,
        dto,
      );
      expect(s.banco.pagamentos).toHaveLength(2);
      expect(
        s.banco.pagamentos.filter((p) => p.idempotencyKey === chave),
      ).toHaveLength(1);
      expect(segunda.paidAmount).toBe('150.00');
      expect(segunda.payments.map((p) => p.id)).toEqual(
        primeira.payments.map((p) => p.id),
      );
    });

    it('clique duplo simultâneo com a mesma chave grava uma vez só', async () => {
      const dto = {
        idempotencyKey: '0c8e6a3d-1f2b-4c5d-9e8f-7a6b5c4d3e2f',
        lines: [{ method: PaymentMethod.PIX, amount: '100.00' }],
      };
      const [a, b] = await Promise.all([
        s.payments.register(OWNER, RECEPCAO, cobrancaId, dto),
        s.payments.register(OWNER, RECEPCAO, cobrancaId, dto),
      ]);
      expect(s.banco.pagamentos).toHaveLength(1);
      expect(a.paidAmount).toBe('100.00');
      expect(b.paidAmount).toBe('100.00');
    });

    it('chave já usada em outra cobrança dá 409', async () => {
      const outra = await s.receivables.create(OWNER, RECEPCAO, {
        patientId: PACIENTE,
        items: [{ description: 'Outra', unitAmount: '80.00' }],
      });
      const chave = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
      await s.payments.register(OWNER, RECEPCAO, cobrancaId, {
        idempotencyKey: chave,
        lines: [{ method: PaymentMethod.PIX, amount: '10.00' }],
      });
      const erro = s.payments.register(OWNER, RECEPCAO, outra.id, {
        idempotencyKey: chave,
        lines: [{ method: PaymentMethod.PIX, amount: '10.00' }],
      });
      await expect(erro).rejects.toBeInstanceOf(ConflictException);
      await expect(
        s.payments.register(OWNER, RECEPCAO, outra.id, {
          idempotencyKey: chave,
          lines: [{ method: PaymentMethod.PIX, amount: '10.00' }],
        }),
      ).rejects.toThrow(CHAVE_DE_OUTRA_COBRANCA);
    });

    it('paidAt no futuro dá 400; retroativo acima de 7 dias exige administração', async () => {
      const futuro = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await expect(
        s.payments.register(OWNER, RECEPCAO, cobrancaId, {
          paidAt: futuro,
          lines: [{ method: PaymentMethod.PIX, amount: '10.00' }],
        }),
      ).rejects.toThrow(DATA_NO_FUTURO);
      const antigo = new Date(
        Date.now() - 10 * 24 * 60 * 60 * 1000,
      ).toISOString();
      await expect(
        s.payments.register(
          OWNER,
          RECEPCAO,
          cobrancaId,
          {
            paidAt: antigo,
            lines: [{ method: PaymentMethod.PIX, amount: '10.00' }],
          },
          [Permission.FINANCEIRO],
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        s.payments.register(OWNER, RECEPCAO, cobrancaId, {
          paidAt: antigo,
          lines: [{ method: PaymentMethod.PIX, amount: '10.00' }],
        }),
      ).rejects.toThrow(DATA_RETROATIVA_DEMAIS);
      expect(s.banco.pagamentos).toHaveLength(0);
      const pago = await s.payments.register(
        OWNER,
        RECEPCAO,
        cobrancaId,
        {
          paidAt: antigo,
          lines: [{ method: PaymentMethod.PIX, amount: '10.00' }],
        },
        [Permission.FINANCEIRO, Permission.ADMINISTRACAO],
      );
      expect(pago.paidAmount).toBe('10.00');
    });

    it('dinheiro com paidAt anterior à abertura do caixa dá 400', async () => {
      await abrirCaixa();
      const antes = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      await expect(
        s.payments.register(OWNER, RECEPCAO, cobrancaId, {
          paidAt: antes,
          lines: [{ method: PaymentMethod.CASH, amount: '10.00' }],
        }),
      ).rejects.toThrow(DINHEIRO_ANTES_DA_ABERTURA);
      const pix = await s.payments.register(OWNER, RECEPCAO, cobrancaId, {
        paidAt: antes,
        lines: [{ method: PaymentMethod.PIX, amount: '10.00' }],
      });
      expect(pix.paidAmount).toBe('10.00');
    });

    it('o caixa de outro usuário não serve para receber em dinheiro', async () => {
      await abrirCaixa(SECRETARIA);
      await expect(
        s.payments.register(OWNER, RECEPCAO, cobrancaId, {
          lines: [{ method: PaymentMethod.CASH, amount: '10.00' }],
        }),
      ).rejects.toThrow(DINHEIRO_SEM_CAIXA);
    });

    it('conta de outro tenant dá 404; conta inativa dá 400', async () => {
      await expect(
        s.payments.register(OWNER, RECEPCAO, cobrancaId, {
          lines: [
            {
              method: PaymentMethod.PIX,
              amount: '10.00',
              accountId: CONTA_DE_FORA,
            },
          ],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      s.banco.contas.find((c) => c.id === CONTA_BANCO)!.active = false;
      await expect(
        s.payments.register(OWNER, RECEPCAO, cobrancaId, {
          lines: [{ method: PaymentMethod.PIX, amount: '10.00' }],
        }),
      ).rejects.toThrow(CONTA_INATIVA);
    });

    it('sem conta informada nem conta padrão dá 400', async () => {
      await expect(
        s.payments.register(OWNER, RECEPCAO, cobrancaId, {
          lines: [{ method: PaymentMethod.BANK_TRANSFER, amount: '10.00' }],
        }),
      ).rejects.toThrow(/conta de destino/);
    });

    it('forma inativa dá 400', async () => {
      await expect(
        s.payments.register(OWNER, RECEPCAO, cobrancaId, {
          lines: [
            {
              method: PaymentMethod.BOLETO,
              amount: '10.00',
              accountId: CONTA_BANCO,
            },
          ],
        }),
      ).rejects.toThrow(/inativa/);
    });

    it('parcelas só no crédito e até o máximo configurado', async () => {
      await expect(
        s.payments.register(OWNER, RECEPCAO, cobrancaId, {
          lines: [
            { method: PaymentMethod.PIX, amount: '10.00', installments: 2 },
          ],
        }),
      ).rejects.toThrow(PARCELAS_SO_NO_CREDITO);
      await expect(
        s.payments.register(OWNER, RECEPCAO, cobrancaId, {
          lines: [
            {
              method: PaymentMethod.CREDIT_CARD,
              amount: '10.00',
              installments: 7,
            },
          ],
        }),
      ).rejects.toThrow(/no máximo 6/);
    });

    it('cobrança cancelada ou de outro tenant é recusada', async () => {
      await expect(
        s.payments.register(OUTRO_OWNER, RECEPCAO, cobrancaId, {
          lines: [{ method: PaymentMethod.PIX, amount: '10.00' }],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await s.receivables.cancel(OWNER, RECEPCAO, cobrancaId, 'x');
      await expect(
        s.payments.register(OWNER, RECEPCAO, cobrancaId, {
          lines: [{ method: PaymentMethod.PIX, amount: '10.00' }],
        }),
      ).rejects.toThrow(COBRANCA_CANCELADA);
    });

    it('findAll lista com totais e respeita o tenant', async () => {
      await s.payments.register(OWNER, RECEPCAO, cobrancaId, {
        lines: [{ method: PaymentMethod.PIX, amount: '100.00' }],
      });
      const lista = await s.payments.findAll(OWNER, {});
      expect(lista.total).toBe(1);
      expect(lista.totalAmount).toBe('100.00');
      expect(lista.data[0]).toMatchObject({
        receivableId: cobrancaId,
        patient: { id: PACIENTE, name: 'Maria' },
        account: { id: CONTA_BANCO },
      });
      expect((await s.payments.findAll(OUTRO_OWNER, {})).total).toBe(0);
    });

    it('findOwnedOrFail não encontra pagamento de outro tenant', async () => {
      const paga = await s.payments.register(OWNER, RECEPCAO, cobrancaId, {
        lines: [{ method: PaymentMethod.PIX, amount: '100.00' }],
      });
      await expect(
        s.payments.findOwnedOrFail(OUTRO_OWNER, paga.payments[0].id),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(
        (await s.payments.findOwnedOrFail(OWNER, paga.payments[0].id)).id,
      ).toBe(paga.payments[0].id);
    });
  });

  describe('refund', () => {
    it('estorno parcial volta a cobrança para parcial e lança saída na conta', async () => {
      const paga = await s.payments.register(OWNER, RECEPCAO, cobrancaId, {
        lines: [{ method: PaymentMethod.PIX, amount: '300.00' }],
      });
      const estornada = await s.refunds.refund(
        OWNER,
        RECEPCAO,
        paga.payments[0].id,
        {
          amount: '50.00',
          reason: RefundReason.COURTESY_DISCOUNT,
          notes: 'Desconto',
        },
      );
      expect(estornada.status).toBe(ReceivableStatus.PARTIAL);
      expect(estornada.paidAmount).toBe('250.00');
      expect(estornada.payments[0].refundedAmount).toBe('50.00');
      expect(estornada.payments[0].refunds[0]).toMatchObject({
        amount: '50.00',
        reason: RefundReason.COURTESY_DISCOUNT,
        refundedBy: { id: RECEPCAO },
      });
      const saida = s.banco.lancamentos.find(
        (l) => l.kind === FinancialEntryKind.REFUND,
      );
      expect(saida).toMatchObject({
        accountId: CONTA_BANCO,
        cashSessionId: null,
        direction: FinancialEntryDirection.OUT,
        amount: '50.00',
      });
    });

    it('estorno maior que o disponível dá 400, inclusive somando estornos anteriores', async () => {
      const paga = await s.payments.register(OWNER, RECEPCAO, cobrancaId, {
        lines: [{ method: PaymentMethod.PIX, amount: '100.00' }],
      });
      const id = paga.payments[0].id;
      await expect(
        s.refunds.refund(OWNER, RECEPCAO, id, {
          amount: '100.01',
          reason: RefundReason.OTHER,
        }),
      ).rejects.toThrow(ESTORNO_ACIMA_DO_PAGO);
      await s.refunds.refund(OWNER, RECEPCAO, id, {
        amount: '60.00',
        reason: RefundReason.OTHER,
      });
      await expect(
        s.refunds.refund(OWNER, RECEPCAO, id, {
          amount: '40.01',
          reason: RefundReason.OTHER,
        }),
      ).rejects.toThrow(ESTORNO_ACIMA_DO_PAGO);
    });

    it('estorno em dinheiro exige caixa aberto e sai do caixa atual', async () => {
      const primeiro = await abrirCaixa();
      const paga = await s.payments.register(OWNER, RECEPCAO, cobrancaId, {
        lines: [{ method: PaymentMethod.CASH, amount: '100.00' }],
      });
      await s.cashSessions.closeCurrent(
        {
          userId: RECEPCAO,
          ownerId: OWNER,
          role: UserRole.COLLABORATOR,
          permissions: [],
        },
        { countedAmount: '200.00' },
      );
      await expect(
        s.refunds.refund(OWNER, RECEPCAO, paga.payments[0].id, {
          amount: '10.00',
          reason: RefundReason.OTHER,
        }),
      ).rejects.toThrow(ESTORNO_EM_DINHEIRO_SEM_CAIXA);

      const atual = await abrirCaixa(RECEPCAO, '50.00');
      await s.refunds.refund(OWNER, RECEPCAO, paga.payments[0].id, {
        amount: '10.00',
        reason: RefundReason.OTHER,
      });
      const saida = s.banco.lancamentos.find(
        (l) => l.kind === FinancialEntryKind.REFUND,
      );
      expect(saida?.cashSessionId).toBe(atual.id);
      expect(saida?.cashSessionId).not.toBe(primeiro.id);
      expect(s.banco.saldoDoCaixa(atual.id)).toBe('40.00');
    });

    it('pagamento de outro tenant dá 404', async () => {
      const paga = await s.payments.register(OWNER, RECEPCAO, cobrancaId, {
        lines: [{ method: PaymentMethod.PIX, amount: '100.00' }],
      });
      await expect(
        s.refunds.refund(OUTRO_OWNER, RECEPCAO, paga.payments[0].id, {
          amount: '1.00',
          reason: RefundReason.OTHER,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
