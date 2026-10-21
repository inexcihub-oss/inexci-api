import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  FinancialEntryDirection,
  FinancialEntryKind,
} from 'src/database/entities/financial-entry.entity';
import { PaymentMethod } from 'src/database/entities/payment-method-config.entity';
import { RefundReason } from 'src/database/entities/refund.entity';
import { UserRole } from 'src/database/entities/user.entity';
import { CashSessionRepository } from 'src/database/repositories/cash-session.repository';
import { AuthenticatedUser } from 'src/shared/decorators/current-user.decorator';
import { Permission } from 'src/shared/permissions';
import {
  CAIXA_JA_ABERTO,
  CAIXA_JA_FECHADO,
  CONTA_NAO_E_CAIXA,
  DIFERENCA_EXIGE_ADMINISTRACAO,
  FECHAR_CAIXA_ALHEIO,
  JUSTIFICATIVA_OBRIGATORIA,
  RETIRADA_ACIMA_DO_SALDO,
  SEM_CAIXA_ABERTO,
  VER_CAIXA_ALHEIO,
} from './cash-sessions.service';
import {
  CONTA_BANCO,
  CONTA_CAIXA,
  CONTA_DE_FORA,
  OUTRO_OWNER,
  OWNER,
  PACIENTE,
  RECEPCAO,
  SECRETARIA,
  ServicosFinanceiros,
  montarServicos,
} from './finance-fakes.helper-spec';
import { DINHEIRO_SEM_CAIXA } from './payments.service';
import { CONTAS_IGUAIS } from './transfers.service';

function usuario(
  userId: string,
  permissions: Permission[] = [Permission.FINANCEIRO],
  ownerId = OWNER,
): AuthenticatedUser {
  return { userId, ownerId, role: UserRole.COLLABORATOR, permissions };
}

describe('CashSessionsService', () => {
  let s: ServicosFinanceiros;

  beforeEach(() => {
    s = montarServicos();
  });

  function abrir(userId = RECEPCAO, openingAmount = '100.00') {
    return s.cashSessions.open(OWNER, userId, {
      accountId: CONTA_CAIXA,
      openingAmount,
    });
  }

  async function cobrar(valor: string) {
    const cobranca = await s.receivables.create(OWNER, RECEPCAO, {
      patientId: PACIENTE,
      items: [{ description: 'Consulta', unitAmount: valor }],
    });
    return cobranca.id;
  }

  describe('open', () => {
    it('abre com suprimento do valor de abertura', async () => {
      const caixa = await abrir();
      expect(caixa.openingAmount).toBe('100.00');
      expect(caixa.cashBalance).toBe('100.00');
      expect(caixa.entries).toEqual([
        expect.objectContaining({
          kind: FinancialEntryKind.SUPPLY,
          direction: FinancialEntryDirection.IN,
          amount: '100.00',
        }),
      ]);
      expect(caixa.user).toEqual({ id: RECEPCAO, name: 'Recepção' });
      expect(caixa.closedAt).toBeNull();
    });

    it('abertura zero não gera lançamento', async () => {
      const caixa = await abrir(RECEPCAO, '0');
      expect(caixa.entries).toHaveLength(0);
      expect(caixa.cashBalance).toBe('0.00');
    });

    it('abrir duas vezes dá 409', async () => {
      await abrir();
      await expect(abrir()).rejects.toThrow(CAIXA_JA_ABERTO);
      await expect(abrir()).rejects.toBeInstanceOf(ConflictException);
    });

    it('a corrida no índice parcial também vira 409', async () => {
      await abrir();
      const repo = (
        s.cashSessions as unknown as {
          cashSessionRepository: CashSessionRepository;
        }
      ).cashSessionRepository;
      repo.findOpenByUser = jest.fn().mockResolvedValue(null);
      await expect(abrir()).rejects.toThrow(CAIXA_JA_ABERTO);
    });

    it('recusa conta que não é caixa físico e conta de outro tenant', async () => {
      await expect(
        s.cashSessions.open(OWNER, RECEPCAO, {
          accountId: CONTA_BANCO,
          openingAmount: '0',
        }),
      ).rejects.toThrow(CONTA_NAO_E_CAIXA);
      await expect(
        s.cashSessions.open(OWNER, RECEPCAO, {
          accountId: CONTA_DE_FORA,
          openingAmount: '0',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('usuários diferentes abrem caixas próprios', async () => {
      await abrir(RECEPCAO);
      const outro = await abrir(SECRETARIA);
      expect(outro.user.id).toBe(SECRETARIA);
    });
  });

  describe('movimentos', () => {
    it('retirada e suprimento mexem no saldo', async () => {
      await abrir();
      await s.cashSessions.supply(OWNER, RECEPCAO, {
        amount: '20.00',
        description: 'Troco',
      });
      const caixa = await s.cashSessions.withdraw(OWNER, RECEPCAO, {
        amount: '70.00',
        description: 'Depósito',
      });
      expect(caixa.cashBalance).toBe('50.00');
      expect(caixa.entries.map((e) => e.kind)).toEqual([
        FinancialEntryKind.SUPPLY,
        FinancialEntryKind.SUPPLY,
        FinancialEntryKind.WITHDRAWAL,
      ]);
    });

    it('retirada acima do saldo dá 400', async () => {
      await abrir();
      await expect(
        s.cashSessions.withdraw(OWNER, RECEPCAO, {
          amount: '100.01',
          description: 'x',
        }),
      ).rejects.toThrow(RETIRADA_ACIMA_DO_SALDO);
    });

    it('sem caixa aberto, retirada e suprimento dão 400', async () => {
      await expect(
        s.cashSessions.supply(OWNER, RECEPCAO, {
          amount: '1.00',
          description: 'x',
        }),
      ).rejects.toThrow(SEM_CAIXA_ABERTO);
      await expect(
        s.cashSessions.withdraw(OWNER, RECEPCAO, {
          amount: '1.00',
          description: 'x',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('summary', () => {
    it('totaliza por forma os pagamentos ligados ao caixa, com estornos', async () => {
      const caixa = await abrir();
      const id = await cobrar('300.00');
      const paga = await s.payments.register(OWNER, RECEPCAO, id, {
        lines: [
          { method: PaymentMethod.CASH, amount: '100.00' },
          { method: PaymentMethod.PIX, amount: '200.00' },
        ],
      });
      await s.refunds.refund(OWNER, RECEPCAO, paga.payments[0].id, {
        amount: '30.00',
        reason: RefundReason.WRONG_AMOUNT,
      });
      const resumo = await s.cashSessions.summary(OWNER, caixa.id);
      expect(resumo.cashBalance).toBe('170.00');
      expect(resumo.totalsByMethod).toEqual([
        {
          method: PaymentMethod.CASH,
          received: '100.00',
          refunded: '30.00',
          net: '70.00',
        },
        {
          method: PaymentMethod.PIX,
          received: '200.00',
          refunded: '0.00',
          net: '200.00',
        },
      ]);
    });

    it('caixa de outro tenant dá 404', async () => {
      const caixa = await abrir();
      await expect(
        s.cashSessions.summary(OUTRO_OWNER, caixa.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('current devolve null sem caixa aberto', async () => {
      expect(await s.cashSessions.current(OWNER, RECEPCAO)).toEqual({
        session: null,
      });
      const caixa = await abrir();
      expect((await s.cashSessions.current(OWNER, RECEPCAO)).session?.id).toBe(
        caixa.id,
      );
    });
  });

  describe('close', () => {
    it('calcula esperado e diferença e transfere o contado para a conta do caixa', async () => {
      const caixa = await abrir();
      const id = await cobrar('150.00');
      await s.payments.register(OWNER, RECEPCAO, id, {
        lines: [{ method: PaymentMethod.CASH, amount: '150.00' }],
      });
      const fechado = await s.cashSessions.closeCurrent(usuario(RECEPCAO), {
        countedAmount: '245.00',
        notes: 'Faltou troco',
      });
      expect(fechado.expectedAmount).toBe('250.00');
      expect(fechado.countedAmount).toBe('245.00');
      expect(fechado.difference).toBe('-5.00');
      expect(fechado.closedBy?.id).toBe(RECEPCAO);
      expect(fechado.notes).toBe('Faltou troco');
      expect(fechado.closedAt).not.toBeNull();

      const fechamento = s.banco.lancamentos.filter(
        (l) => l.kind === FinancialEntryKind.SESSION_CLOSING,
      );
      const saida = fechamento.find(
        (l) => l.direction === FinancialEntryDirection.OUT,
      );
      const entrada = fechamento.find(
        (l) => l.direction === FinancialEntryDirection.IN,
      );
      expect(saida).toMatchObject({
        cashSessionId: caixa.id,
        accountId: null,
        amount: '245.00',
      });
      expect(entrada).toMatchObject({
        cashSessionId: null,
        accountId: CONTA_CAIXA,
        amount: '245.00',
      });
      expect(saida?.counterpartEntryId).toBe(entrada?.id);
      expect(entrada?.counterpartEntryId).toBe(saida?.id);
    });

    it('diferença acima de R$ 50,00 exige justificativa', async () => {
      await abrir(RECEPCAO, '100.00');
      await expect(
        s.cashSessions.closeCurrent(usuario(RECEPCAO), {
          countedAmount: '49.99',
        }),
      ).rejects.toThrow(JUSTIFICATIVA_OBRIGATORIA);
      await expect(
        s.cashSessions.closeCurrent(usuario(RECEPCAO), {
          countedAmount: '49.99',
          notes: '   ',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(s.banco.caixas[0].closedAt).toBeNull();
      const fechado = await s.cashSessions.closeCurrent(usuario(RECEPCAO), {
        countedAmount: '49.99',
        notes: 'Pagamento de fornecedor sem registro',
      });
      expect(fechado.difference).toBe('-50.01');
    });

    it('diferença de até R$ 50,00 não exige justificativa', async () => {
      await abrir(RECEPCAO, '100.00');
      const fechado = await s.cashSessions.closeCurrent(usuario(RECEPCAO), {
        countedAmount: '150.00',
      });
      expect(fechado.difference).toBe('50.00');
    });

    it('diferença acima de R$ 1.000,00 só fecha quem administra', async () => {
      await abrir(RECEPCAO, '2000.00');
      await expect(
        s.cashSessions.closeCurrent(usuario(RECEPCAO), {
          countedAmount: '999.99',
          notes: 'Sumiu',
        }),
      ).rejects.toThrow(DIFERENCA_EXIGE_ADMINISTRACAO);
      const fechado = await s.cashSessions.closeCurrent(
        usuario(RECEPCAO, [Permission.FINANCEIRO, Permission.ADMINISTRACAO]),
        { countedAmount: '999.99', notes: 'Conferido com a gerência' },
      );
      expect(fechado.difference).toBe('-1000.01');
    });

    it('contado zero fecha sem lançamentos de fechamento', async () => {
      await abrir(RECEPCAO, '0');
      const fechado = await s.cashSessions.closeCurrent(usuario(RECEPCAO), {
        countedAmount: '0',
      });
      expect(fechado.difference).toBe('0.00');
      expect(
        s.banco.lancamentos.filter(
          (l) => l.kind === FinancialEntryKind.SESSION_CLOSING,
        ),
      ).toHaveLength(0);
    });

    it('depois de fechado não entra pagamento em dinheiro nem movimento', async () => {
      await abrir();
      await s.cashSessions.closeCurrent(usuario(RECEPCAO), {
        countedAmount: '100.00',
      });
      const id = await cobrar('50.00');
      await expect(
        s.payments.register(OWNER, RECEPCAO, id, {
          lines: [{ method: PaymentMethod.CASH, amount: '50.00' }],
        }),
      ).rejects.toThrow(DINHEIRO_SEM_CAIXA);
      await expect(
        s.cashSessions.supply(OWNER, RECEPCAO, {
          amount: '1.00',
          description: 'x',
        }),
      ).rejects.toThrow(SEM_CAIXA_ABERTO);
    });

    it('fechar duas vezes dá 400 e sem caixa aberto dá 400', async () => {
      const caixa = await abrir();
      await s.cashSessions.close(usuario(RECEPCAO), caixa.id, {
        countedAmount: '100.00',
      });
      await expect(
        s.cashSessions.close(usuario(RECEPCAO), caixa.id, {
          countedAmount: '100.00',
        }),
      ).rejects.toThrow(CAIXA_JA_FECHADO);
      await expect(
        s.cashSessions.closeCurrent(usuario(RECEPCAO), {
          countedAmount: '0',
        }),
      ).rejects.toThrow(SEM_CAIXA_ABERTO);
    });

    it('quem administra fecha o caixa esquecido de outro usuário', async () => {
      const caixa = await abrir(SECRETARIA);
      const fechado = await s.cashSessions.close(
        usuario(RECEPCAO, [Permission.FINANCEIRO, Permission.ADMINISTRACAO]),
        caixa.id,
        { countedAmount: '100.00' },
      );
      expect(fechado.closedBy?.id).toBe(RECEPCAO);
      expect(fechado.user.id).toBe(SECRETARIA);
    });

    it('colaborador comum não fecha caixa alheio', async () => {
      const caixa = await abrir(SECRETARIA);
      await expect(
        s.cashSessions.close(usuario(RECEPCAO), caixa.id, {
          countedAmount: '100.00',
        }),
      ).rejects.toThrow(FECHAR_CAIXA_ALHEIO);
      await expect(
        s.cashSessions.close(usuario(RECEPCAO), caixa.id, {
          countedAmount: '100.00',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(s.banco.caixas[0].closedAt).toBeNull();
    });

    it('caixa de outro tenant dá 404 mesmo para quem administra', async () => {
      const caixa = await abrir();
      await expect(
        s.cashSessions.close(
          usuario(
            RECEPCAO,
            [Permission.FINANCEIRO, Permission.ADMINISTRACAO],
            OUTRO_OWNER,
          ),
          caixa.id,
          { countedAmount: '0' },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('list e relatório', () => {
    it('lista caixas do tenant', async () => {
      await abrir();
      const lista = await s.cashSessions.list(usuario(RECEPCAO), {});
      expect(lista.total).toBe(1);
      expect(lista.data[0].account.id).toBe(CONTA_CAIXA);
      expect(
        (
          await s.cashSessions.list(
            usuario(RECEPCAO, [Permission.FINANCEIRO], OUTRO_OWNER),
            {},
          )
        ).total,
      ).toBe(0);
    });

    it('sem administração, a lista traz só os próprios caixas', async () => {
      await abrir(RECEPCAO);
      await abrir(SECRETARIA);
      const propria = await s.cashSessions.list(usuario(RECEPCAO), {});
      expect(propria.data.map((c) => c.user.id)).toEqual([RECEPCAO]);
      await expect(
        s.cashSessions.list(usuario(RECEPCAO), { userId: SECRETARIA }),
      ).rejects.toThrow(VER_CAIXA_ALHEIO);
      const admin = await s.cashSessions.list(
        usuario(RECEPCAO, [Permission.FINANCEIRO, Permission.ADMINISTRACAO]),
        {},
      );
      expect(admin.total).toBe(2);
      const filtrada = await s.cashSessions.list(
        usuario(RECEPCAO, [Permission.FINANCEIRO, Permission.ADMINISTRACAO]),
        { userId: SECRETARIA },
      );
      expect(filtrada.data.map((c) => c.user.id)).toEqual([SECRETARIA]);
    });

    it('resumo e CSV de caixa alheio só para quem administra', async () => {
      const alheio = await abrir(SECRETARIA);
      await expect(
        s.cashSessions.summaryFor(usuario(RECEPCAO), alheio.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        s.cashSessions.reportCsv(usuario(RECEPCAO), alheio.id),
      ).rejects.toThrow(VER_CAIXA_ALHEIO);
      const proprio = await s.cashSessions.summaryFor(
        usuario(SECRETARIA),
        alheio.id,
      );
      expect(proprio.id).toBe(alheio.id);
      const admin = await s.cashSessions.reportCsv(
        usuario(RECEPCAO, [Permission.FINANCEIRO, Permission.ADMINISTRACAO]),
        alheio.id,
      );
      expect(admin).toContain('Seção;');
      await expect(
        s.cashSessions.summaryFor(
          usuario(RECEPCAO, [Permission.FINANCEIRO], OUTRO_OWNER),
          alheio.id,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('gera CSV com cabeçalho em português, movimentos e totais por forma', async () => {
      const caixa = await abrir();
      const id = await cobrar('80.00');
      await s.payments.register(OWNER, RECEPCAO, id, {
        lines: [{ method: PaymentMethod.CASH, amount: '80.00' }],
      });
      const csv = await s.cashSessions.reportCsv(usuario(RECEPCAO), caixa.id);
      const linhas = csv.trim().split('\r\n');
      expect(linhas[0]).toBe(
        'Seção;Data/hora;Tipo;Descrição;Entrada/Recebido;Saída/Estornado;Valor/Líquido',
      );
      expect(csv).toContain('Suprimento (Entrada);Abertura de caixa;100,00;;');
      expect(csv).toContain('Total por forma;;Dinheiro;;80,00;0,00;80,00');
      expect(csv).toContain('Resumo;;Saldo em dinheiro;;;;180,00');
    });
  });
});

describe('TransfersService', () => {
  let s: ServicosFinanceiros;

  beforeEach(() => {
    s = montarServicos();
  });

  it('gera o par de lançamentos ligados por contrapartida', async () => {
    const resultado = await s.transfers.transfer(OWNER, RECEPCAO, {
      fromAccountId: CONTA_CAIXA,
      toAccountId: CONTA_BANCO,
      amount: '500.00',
    });
    const saida = s.banco.lancamentos.find(
      (l) => l.id === resultado.outEntryId,
    );
    const entrada = s.banco.lancamentos.find(
      (l) => l.id === resultado.inEntryId,
    );
    expect(saida).toMatchObject({
      accountId: CONTA_CAIXA,
      direction: FinancialEntryDirection.OUT,
      kind: FinancialEntryKind.TRANSFER,
      amount: '500.00',
      counterpartEntryId: resultado.inEntryId,
    });
    expect(entrada).toMatchObject({
      accountId: CONTA_BANCO,
      direction: FinancialEntryDirection.IN,
      counterpartEntryId: resultado.outEntryId,
    });
  });

  it('occurredAt no futuro dá 400 e retroativo acima de 7 dias exige administração', async () => {
    const base = {
      fromAccountId: CONTA_CAIXA,
      toAccountId: CONTA_BANCO,
      amount: '10.00',
    };
    await expect(
      s.transfers.transfer(OWNER, RECEPCAO, {
        ...base,
        occurredAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const antigo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await expect(
      s.transfers.transfer(OWNER, RECEPCAO, { ...base, occurredAt: antigo }, [
        Permission.FINANCEIRO,
      ]),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(s.banco.lancamentos).toHaveLength(0);
    await s.transfers.transfer(
      OWNER,
      RECEPCAO,
      { ...base, occurredAt: antigo },
      [Permission.FINANCEIRO, Permission.ADMINISTRACAO],
    );
    expect(s.banco.lancamentos).toHaveLength(2);
  });

  it('recusa contas iguais, de outro tenant e inativas', async () => {
    await expect(
      s.transfers.transfer(OWNER, RECEPCAO, {
        fromAccountId: CONTA_BANCO,
        toAccountId: CONTA_BANCO,
        amount: '1.00',
      }),
    ).rejects.toThrow(CONTAS_IGUAIS);
    await expect(
      s.transfers.transfer(OWNER, RECEPCAO, {
        fromAccountId: CONTA_BANCO,
        toAccountId: CONTA_DE_FORA,
        amount: '1.00',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    s.banco.contas.find((c) => c.id === CONTA_CAIXA)!.active = false;
    await expect(
      s.transfers.transfer(OWNER, RECEPCAO, {
        fromAccountId: CONTA_CAIXA,
        toAccountId: CONTA_BANCO,
        amount: '1.00',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(s.banco.lancamentos).toHaveLength(0);
  });
});
