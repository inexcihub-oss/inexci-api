import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod } from 'src/database/entities/payment-method-config.entity';
import { ReceivableStatus } from 'src/database/entities/receivable.entity';
import { RefundReason } from 'src/database/entities/refund.entity';
import {
  CONSULTA,
  CONSULTA_CANCELADA,
  CONSULTA_CONVENIO,
  CONSULTA_DE_FORA,
  CONSULTA_FALTOU,
  CONSULTA_SEM_PRECO,
  MEDICO,
  MEDICO_DE_FORA,
  OUTRO_OWNER,
  OWNER,
  PACIENTE,
  PACIENTE_DE_FORA,
  PSICOLOGA,
  RECEPCAO,
  ServicosFinanceiros,
  montarServicos,
} from './finance-fakes.helper-spec';
import {
  CODIGO_CONSULTA_CANCELADA,
  CODIGO_CONSULTA_DE_CONVENIO,
  CODIGO_CONSULTA_SEM_COMPARECIMENTO,
  CODIGO_CONSULTA_SEM_VALOR,
  COBRANCA_COM_PAGAMENTO,
  CONSULTA_DE_CONVENIO,
  CONSULTA_JA_COBRADA,
  DESCONTO_ACIMA_DO_VALOR,
  EXECUTANTE_SEM_PERFIL,
  ITEM_ABAIXO_DO_PAGO,
  ULTIMO_ITEM,
  VALOR_FORA_DO_LIMITE,
} from './receivables.service';

async function respostaDoErro(promessa: Promise<unknown>) {
  try {
    await promessa;
  } catch (erro) {
    expect(erro).toBeInstanceOf(BadRequestException);
    return (erro as BadRequestException).getResponse() as {
      code?: string;
      message?: string;
    };
  }
  throw new Error('Era esperado um erro');
}

describe('ReceivablesService', () => {
  let s: ServicosFinanceiros;

  beforeEach(() => {
    s = montarServicos();
  });

  function avulsa(unitAmount = '200.00', extra = {}) {
    return s.receivables.create(OWNER, RECEPCAO, {
      patientId: PACIENTE,
      items: [{ description: 'Infiltração', unitAmount, ...extra }],
    });
  }

  describe('create', () => {
    it('cria cobrança avulsa com total somado dos itens e status aberto', async () => {
      const cobranca = await s.receivables.create(OWNER, RECEPCAO, {
        patientId: PACIENTE,
        items: [
          {
            description: 'Consulta',
            unitAmount: '300.00',
            executedById: MEDICO,
          },
          {
            description: 'Curativo',
            unitAmount: '25.50',
            quantity: 2,
            discount: '1.00',
          },
        ],
      });
      expect(cobranca.totalAmount).toBe('350.00');
      expect(cobranca.paidAmount).toBe('0.00');
      expect(cobranca.balance).toBe('350.00');
      expect(cobranca.status).toBe(ReceivableStatus.OPEN);
      expect(cobranca.description).toBe('Consulta, Curativo');
      expect(cobranca.items[0].executedBy).toEqual({
        id: MEDICO,
        name: 'Dr. Fabio',
      });
      expect(cobranca.createdBy?.id).toBe(RECEPCAO);
    });

    it('grava o total de cada item e executedAt mesmo sem executante', async () => {
      const cobranca = await s.receivables.create(OWNER, RECEPCAO, {
        patientId: PACIENTE,
        referenceDate: '2026-10-15',
        items: [
          {
            description: 'Curativo',
            unitAmount: '25.50',
            quantity: 2,
            discount: '1.00',
            surcharge: '0.50',
          },
        ],
      });
      const [item] = s.banco.itens.filter(
        (i) => i.receivableId === cobranca.id,
      );
      expect(item.total).toBe('50.50');
      expect(item.executedById).toBeNull();
      expect(item.executedAt).toBe('2026-10-15');
    });

    it('recusa cobrança cujo total somado passa do limite de numeric(12,2)', async () => {
      await expect(
        s.receivables.create(OWNER, RECEPCAO, {
          patientId: PACIENTE,
          items: [
            { description: 'A', unitAmount: '9000000000.00' },
            { description: 'B', unitAmount: '9000000000.00' },
          ],
        }),
      ).rejects.toThrow(VALOR_FORA_DO_LIMITE);
      expect(s.banco.cobrancas).toHaveLength(0);
    });

    it('cobrança de total zero nasce paga', async () => {
      const cobranca = await avulsa('0.00');
      expect(cobranca.status).toBe(ReceivableStatus.PAID);
    });

    it('recusa desconto maior que o valor do item', async () => {
      await expect(avulsa('10.00', { discount: '10.01' })).rejects.toThrow(
        DESCONTO_ACIMA_DO_VALOR,
      );
    });

    it('recusa paciente de outro tenant com 404', async () => {
      await expect(
        s.receivables.create(OWNER, RECEPCAO, {
          patientId: PACIENTE_DE_FORA,
          items: [{ description: 'X', unitAmount: '1.00' }],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('recusa consulta de outro tenant com 404', async () => {
      await expect(
        s.receivables.create(OWNER, RECEPCAO, {
          patientId: PACIENTE,
          appointmentId: CONSULTA_DE_FORA,
          items: [{ description: 'X', unitAmount: '1.00' }],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('recusa executante de outro tenant com 404', async () => {
      await expect(
        avulsa('10.00', { executedById: MEDICO_DE_FORA }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(s.banco.cobrancas).toHaveLength(0);
    });

    it('recusa executante do tenant sem perfil profissional', async () => {
      await expect(avulsa('10.00', { executedById: RECEPCAO })).rejects.toThrow(
        EXECUTANTE_SEM_PERFIL,
      );
    });

    it('consulta já com cobrança ativa dá 409', async () => {
      await s.receivables.createFromAppointment(OWNER, RECEPCAO, CONSULTA);
      await expect(
        s.receivables.create(OWNER, RECEPCAO, {
          patientId: PACIENTE,
          appointmentId: CONSULTA,
          items: [{ description: 'X', unitAmount: '1.00' }],
        }),
      ).rejects.toThrow(CONSULTA_JA_COBRADA);
    });

    it('converte a violação do índice parcial em 409', async () => {
      const banco = s.banco;
      const repo = (
        s.receivables as unknown as {
          receivableRepository: { findActiveByAppointments: jest.Mock };
        }
      ).receivableRepository;
      await s.receivables.createFromAppointment(OWNER, RECEPCAO, CONSULTA);
      repo.findActiveByAppointments = jest.fn().mockResolvedValue([]);
      await expect(
        s.receivables.createFromAppointment(OWNER, RECEPCAO, CONSULTA),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(banco.cobrancas).toHaveLength(1);
    });
  });

  describe('createFromAppointment', () => {
    it('pré-preenche paciente, item, executante e valor da consulta', async () => {
      const cobranca = await s.receivables.createFromAppointment(
        OWNER,
        RECEPCAO,
        CONSULTA,
      );
      expect(cobranca.patient.id).toBe(PACIENTE);
      expect(cobranca.appointmentId).toBe(CONSULTA);
      expect(cobranca.referenceDate).toBe('2026-10-20');
      expect(cobranca.totalAmount).toBe('350.00');
      expect(cobranca.items[0]).toMatchObject({
        description: 'Primeira consulta - Dr. Fabio',
        executedBy: { id: MEDICO, name: 'Dr. Fabio' },
        executedAt: '2026-10-20',
        appointmentId: CONSULTA,
      });
    });

    it('consulta de convênio exige confirmação explícita, com código próprio', async () => {
      const resposta = await respostaDoErro(
        s.receivables.createFromAppointment(OWNER, RECEPCAO, CONSULTA_CONVENIO),
      );
      expect(resposta).toMatchObject({
        code: CODIGO_CONSULTA_DE_CONVENIO,
        message: CONSULTA_DE_CONVENIO,
      });
      const cobranca = await s.receivables.createFromAppointment(
        OWNER,
        RECEPCAO,
        CONSULTA_CONVENIO,
        { allowHealthPlan: true, unitAmount: '120.00' },
      );
      expect(cobranca.totalAmount).toBe('120.00');
      expect(cobranca.status).toBe(ReceivableStatus.OPEN);
    });

    it('consulta sem valor e sem unitAmount dá 400 e não gera cobrança paga de R$ 0', async () => {
      const resposta = await respostaDoErro(
        s.receivables.createFromAppointment(
          OWNER,
          RECEPCAO,
          CONSULTA_SEM_PRECO,
        ),
      );
      expect(resposta.code).toBe(CODIGO_CONSULTA_SEM_VALOR);
      const convenio = await respostaDoErro(
        s.receivables.createFromAppointment(
          OWNER,
          RECEPCAO,
          CONSULTA_CONVENIO,
          {
            allowHealthPlan: true,
          },
        ),
      );
      expect(convenio.code).toBe(CODIGO_CONSULTA_SEM_VALOR);
      expect(s.banco.cobrancas).toHaveLength(0);
    });

    it('consulta sem valor usa o unitAmount informado', async () => {
      const cobranca = await s.receivables.createFromAppointment(
        OWNER,
        RECEPCAO,
        CONSULTA_SEM_PRECO,
        { unitAmount: '280' },
      );
      expect(cobranca.totalAmount).toBe('280.00');
      expect(cobranca.status).toBe(ReceivableStatus.OPEN);
    });

    it('unitAmount informado prevalece sobre o valor da consulta', async () => {
      const cobranca = await s.receivables.createFromAppointment(
        OWNER,
        RECEPCAO,
        CONSULTA,
        { unitAmount: '300.00' },
      );
      expect(cobranca.totalAmount).toBe('300.00');
    });

    it('recusa cobrar consulta cancelada ou com falta', async () => {
      const cancelada = await respostaDoErro(
        s.receivables.createFromAppointment(
          OWNER,
          RECEPCAO,
          CONSULTA_CANCELADA,
        ),
      );
      expect(cancelada.code).toBe(CODIGO_CONSULTA_CANCELADA);
      const faltou = await respostaDoErro(
        s.receivables.createFromAppointment(OWNER, RECEPCAO, CONSULTA_FALTOU),
      );
      expect(faltou.code).toBe(CODIGO_CONSULTA_SEM_COMPARECIMENTO);
      expect(s.banco.cobrancas).toHaveLength(0);
    });

    it('consulta de outro tenant dá 404', async () => {
      await expect(
        s.receivables.createFromAppointment(OWNER, RECEPCAO, CONSULTA_DE_FORA),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('cancelar libera a consulta para nova cobrança', async () => {
      const primeira = await s.receivables.createFromAppointment(
        OWNER,
        RECEPCAO,
        CONSULTA,
      );
      await s.receivables.cancel(OWNER, RECEPCAO, primeira.id, 'Errada');
      const segunda = await s.receivables.createFromAppointment(
        OWNER,
        RECEPCAO,
        CONSULTA,
      );
      expect(segunda.id).not.toBe(primeira.id);
    });
  });

  describe('itens', () => {
    it('addItem recalcula total e status', async () => {
      const cobranca = await avulsa('100.00');
      await s.payments.register(OWNER, RECEPCAO, cobranca.id, {
        lines: [{ method: PaymentMethod.PIX, amount: '100.00' }],
      });
      const atualizada = await s.receivables.addItem(
        OWNER,
        RECEPCAO,
        cobranca.id,
        { description: 'Material', unitAmount: '50.00' },
      );
      expect(atualizada.totalAmount).toBe('150.00');
      expect(atualizada.status).toBe(ReceivableStatus.PARTIAL);
    });

    it('addItem recusa quando o total somado passa do limite', async () => {
      const cobranca = await avulsa('9000000000.00');
      await expect(
        s.receivables.addItem(OWNER, RECEPCAO, cobranca.id, {
          description: 'Extra',
          unitAmount: '1000000000.00',
        }),
      ).rejects.toThrow(VALOR_FORA_DO_LIMITE);
      const atual = await s.receivables.findOne(OWNER, cobranca.id);
      expect(atual.totalAmount).toBe('9000000000.00');
    });

    it('cancelItem recalcula o total', async () => {
      const cobranca = await s.receivables.create(OWNER, RECEPCAO, {
        patientId: PACIENTE,
        items: [
          { description: 'A', unitAmount: '100.00' },
          { description: 'B', unitAmount: '50.00' },
        ],
      });
      const atualizada = await s.receivables.cancelItem(
        OWNER,
        RECEPCAO,
        cobranca.id,
        cobranca.items[1].id,
      );
      expect(atualizada.totalAmount).toBe('100.00');
      expect(atualizada.description).toBe('A');
      expect(atualizada.items[1].cancelledAt).not.toBeNull();
    });

    it('cancelItem recusa deixar o total abaixo do pago', async () => {
      const cobranca = await s.receivables.create(OWNER, RECEPCAO, {
        patientId: PACIENTE,
        items: [
          { description: 'A', unitAmount: '100.00' },
          { description: 'B', unitAmount: '50.00' },
        ],
      });
      await s.payments.register(OWNER, RECEPCAO, cobranca.id, {
        lines: [{ method: PaymentMethod.PIX, amount: '120.00' }],
      });
      await expect(
        s.receivables.cancelItem(
          OWNER,
          RECEPCAO,
          cobranca.id,
          cobranca.items[1].id,
        ),
      ).rejects.toThrow(ITEM_ABAIXO_DO_PAGO);
    });

    it('cancelItem recusa remover o último item', async () => {
      const cobranca = await avulsa();
      await expect(
        s.receivables.cancelItem(
          OWNER,
          RECEPCAO,
          cobranca.id,
          cobranca.items[0].id,
        ),
      ).rejects.toThrow(ULTIMO_ITEM);
    });

    it('item de cobrança de outro tenant dá 404', async () => {
      const cobranca = await avulsa();
      await expect(
        s.receivables.addItem(OUTRO_OWNER, RECEPCAO, cobranca.id, {
          description: 'X',
          unitAmount: '1.00',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        s.receivables.cancelItem(
          OUTRO_OWNER,
          RECEPCAO,
          cobranca.id,
          cobranca.items[0].id,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('cancel', () => {
    it('cancela cobrança sem pagamento guardando quem e por quê', async () => {
      const cobranca = await avulsa();
      const cancelada = await s.receivables.cancel(
        OWNER,
        RECEPCAO,
        cobranca.id,
        'Lançada em duplicidade',
      );
      expect(cancelada.status).toBe(ReceivableStatus.CANCELLED);
      expect(cancelada.cancelReason).toBe('Lançada em duplicidade');
      expect(cancelada.cancelledBy?.id).toBe(RECEPCAO);
    });

    it('recusa cancelar com pagamento', async () => {
      const cobranca = await avulsa();
      await s.payments.register(OWNER, RECEPCAO, cobranca.id, {
        lines: [{ method: PaymentMethod.PIX, amount: '10.00' }],
      });
      await expect(
        s.receivables.cancel(OWNER, RECEPCAO, cobranca.id, 'x'),
      ).rejects.toThrow(COBRANCA_COM_PAGAMENTO);
    });

    it('permite cancelar depois de estornar tudo', async () => {
      const cobranca = await avulsa();
      const paga = await s.payments.register(OWNER, RECEPCAO, cobranca.id, {
        lines: [{ method: PaymentMethod.PIX, amount: '10.00' }],
      });
      await s.refunds.refund(OWNER, RECEPCAO, paga.payments[0].id, {
        amount: '10.00',
        reason: RefundReason.DUPLICATE_ENTRY,
      });
      const cancelada = await s.receivables.cancel(
        OWNER,
        RECEPCAO,
        cobranca.id,
        'x',
      );
      expect(cancelada.status).toBe(ReceivableStatus.CANCELLED);
    });

    it('recusa cancelar duas vezes e cobrança de outro tenant', async () => {
      const cobranca = await avulsa();
      await s.receivables.cancel(OWNER, RECEPCAO, cobranca.id, 'x');
      await expect(
        s.receivables.cancel(OWNER, RECEPCAO, cobranca.id, 'x'),
      ).rejects.toBeInstanceOf(BadRequestException);
      const outra = await avulsa();
      await expect(
        s.receivables.cancel(OUTRO_OWNER, RECEPCAO, outra.id, 'x'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('profissionais', () => {
    it('lista quem tem perfil profissional de qualquer conselho, só do tenant', async () => {
      const lista = await s.receivables.professionals(OWNER);
      expect(lista).toEqual([
        {
          id: MEDICO,
          name: 'Dr. Fabio',
          council: 'CRM',
          registry: 'CRM 12345/SP',
        },
        {
          id: PSICOLOGA,
          name: 'Psicóloga Ana',
          council: 'CRP',
          registry: null,
        },
      ]);
    });

    it('aceita executante de outro conselho', async () => {
      const cobranca = await avulsa('100.00', { executedById: PSICOLOGA });
      expect(cobranca.items[0].executedBy?.id).toBe(PSICOLOGA);
    });
  });

  describe('leituras', () => {
    it('findOne de outro tenant dá 404', async () => {
      const cobranca = await avulsa();
      await expect(
        s.receivables.findOne(OUTRO_OWNER, cobranca.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('findAll pagina e soma o total em aberto', async () => {
      await avulsa('100.00');
      const parcial = await avulsa('80.00');
      await s.payments.register(OWNER, RECEPCAO, parcial.id, {
        lines: [{ method: PaymentMethod.PIX, amount: '30.00' }],
      });
      const resposta = await s.receivables.findAll(OWNER, {
        page: 1,
        limit: 1,
      });
      expect(resposta.total).toBe(2);
      expect(resposta.data).toHaveLength(1);
      expect(resposta.totalOpenAmount).toBe('150.00');
      const deFora = await s.receivables.findAll(OUTRO_OWNER, {});
      expect(deFora.total).toBe(0);
    });

    it('resumo do paciente traz em aberto e histórico, só do tenant', async () => {
      await avulsa('100.00');
      const resumo = await s.receivables.patientSummary(OWNER, PACIENTE);
      expect(resumo.openAmount).toBe('100.00');
      expect(resumo.receivables).toHaveLength(1);
      await expect(
        s.receivables.patientSummary(OWNER, PACIENTE_DE_FORA),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('status das consultas ignora canceladas e outros tenants', async () => {
      const cobranca = await s.receivables.createFromAppointment(
        OWNER,
        RECEPCAO,
        CONSULTA,
      );
      expect(
        await s.receivables.appointmentsStatus(OWNER, [CONSULTA, CONSULTA]),
      ).toEqual([
        {
          appointmentId: CONSULTA,
          receivableId: cobranca.id,
          status: ReceivableStatus.OPEN,
        },
      ]);
      expect(
        await s.receivables.appointmentsStatus(OUTRO_OWNER, [CONSULTA]),
      ).toEqual([]);
      await s.receivables.cancel(OWNER, RECEPCAO, cobranca.id, 'x');
      expect(await s.receivables.appointmentsStatus(OWNER, [CONSULTA])).toEqual(
        [],
      );
    });
  });
});
