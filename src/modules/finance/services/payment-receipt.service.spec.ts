import { NotFoundException } from '@nestjs/common';
import { PaymentMethod } from 'src/database/entities/payment-method-config.entity';
import { FinanceReportsRepository } from 'src/database/repositories/finance-reports.repository';
import { PaymentReceiptIssueRepository } from 'src/database/repositories/payment-receipt-issue.repository';
import { DoctorPdfContextService } from 'src/shared/pdf/doctor-pdf-context.service';
import { PdfService } from 'src/shared/pdf/pdf.service';
import {
  PaymentReceiptService,
  descreverFormaDePagamento,
  localEData,
} from './payment-receipt.service';

const agora = new Date('2026-10-21T02:30:00Z');

function pagamento(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    ownerId: 'owner-1',
    method: PaymentMethod.CREDIT_CARD,
    amount: '1234.56',
    refundedAmount: '0.00',
    paidAt: new Date('2026-10-21T02:30:00Z'),
    installments: 3,
    cardBrand: 'Visa',
    receivable: {
      id: 'rec-1',
      ownerId: 'owner-1',
      patient: { id: 'pat-1', name: 'Ana Souza', cpf: '14685854608' },
      items: [
        {
          id: 'i-0',
          description: 'Item cancelado',
          executedById: 'doc-cancelado',
          cancelledAt: new Date(),
        },
        {
          id: 'i-1',
          description: 'Consulta',
          executedById: 'doc-1',
          cancelledAt: null,
        },
        {
          id: 'i-2',
          description: 'Infiltração',
          executedById: null,
          cancelledAt: null,
        },
      ],
    },
    ...overrides,
  };
}

function contexto(overrides: Record<string, unknown> = {}) {
  return {
    doctor: {
      id: 'doc-1',
      ownerId: 'owner-1',
      name: 'Dr. Fabio',
      city: 'Belo Horizonte',
      state: 'MG',
    },
    profile: { specialty: 'Ortopedia' },
    doctorCrm: 'CRM 12345/MG',
    doctorSignatureUrl: 'https://r2.cloudflarestorage.com/assinatura.png',
    customHeader: {
      logoUrl: 'https://r2.cloudflarestorage.com/logo.png',
      logoPosition: 'left',
      contentHtml: '<p>Clínica</p>',
    },
    ...overrides,
  };
}

function montar() {
  const repo = { dadosDoRecibo: jest.fn().mockResolvedValue(pagamento()) };
  const doctorContext = {
    buildForDoctorId: jest.fn().mockResolvedValue(contexto()),
  };
  const pdfService = {
    generateReceiptPdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
    renderClinicalDocumentHtml: jest.fn().mockResolvedValue('<html></html>'),
  };
  const emissoes = { register: jest.fn().mockResolvedValue(undefined) };
  const service = new PaymentReceiptService(
    repo as unknown as FinanceReportsRepository,
    doctorContext as unknown as DoctorPdfContextService,
    pdfService as unknown as PdfService,
    emissoes as unknown as PaymentReceiptIssueRepository,
  );
  return { repo, doctorContext, pdfService, service, emissoes };
}

describe('PaymentReceiptService', () => {
  it('pagamento de outro tenant responde 404', async () => {
    const { repo, service, doctorContext } = montar();
    repo.dadosDoRecibo.mockResolvedValue(null);

    await expect(
      service.montarDados('owner-1', 'pay-x'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.dadosDoRecibo).toHaveBeenCalledWith('owner-1', 'pay-x');
    expect(doctorContext.buildForDoctorId).not.toHaveBeenCalled();
  });

  it('monta o recibo com o cabeçalho do executante do primeiro item não cancelado', async () => {
    const { service, doctorContext } = montar();

    const dados = await service.montarDados('owner-1', 'pay-1', { agora });

    expect(doctorContext.buildForDoctorId).toHaveBeenCalledTimes(1);
    expect(doctorContext.buildForDoctorId).toHaveBeenCalledWith('doc-1');
    expect(dados).toEqual({
      today: '20/10/2026',
      patientName: 'Ana Souza',
      patientCpf: '146.858.546-08',
      amount: 'R$ 1.234,56',
      amountInWords:
        'mil duzentos e trinta e quatro reais e cinquenta e seis centavos',
      description: 'Consulta, Infiltração',
      paymentMethod: 'Cartão de crédito em 3x (Visa)',
      paidAt: '20/10/2026',
      placeAndDate: 'Belo Horizonte/MG, 20/10/2026',
      showPlaceAndDate: true,
      refundedAmount: undefined,
      doctorName: 'Dr. Fabio',
      doctorCrm: 'CRM 12345/MG',
      doctorSpecialty: 'Ortopedia',
      doctorSignatureUrl: undefined,
      customHeader: {
        logoUrl: 'https://r2.cloudflarestorage.com/logo.png',
        logoPosition: 'left',
        contentHtml: '<p>Clínica</p>',
      },
    });
  });

  it('assinatura só sai quando quem emite é o próprio executante', async () => {
    const { service } = montar();
    const doExecutante = await service.montarDados('owner-1', 'pay-1', {
      emitidoPor: 'doc-1',
      agora,
    });
    expect(doExecutante.doctorSignatureUrl).toBe(
      'https://r2.cloudflarestorage.com/assinatura.png',
    );
    const daRecepcao = await service.montarDados('owner-1', 'pay-1', {
      emitidoPor: 'recepcao-1',
      agora,
    });
    expect(daRecepcao.doctorSignatureUrl).toBeUndefined();
    expect(daRecepcao.doctorName).toBe('Dr. Fabio');
    expect(daRecepcao.doctorCrm).toBe('CRM 12345/MG');
  });

  it('sem executante o recibo sai sem assinatura, mesmo emitido pelo dono', async () => {
    const { repo, service, doctorContext } = montar();
    repo.dadosDoRecibo.mockResolvedValue(
      pagamento({
        receivable: {
          id: 'rec-1',
          ownerId: 'owner-1',
          patient: { id: 'pat-1', name: 'Ana', cpf: null },
          items: [
            {
              id: 'i-1',
              description: 'Consulta',
              executedById: null,
              cancelledAt: null,
            },
          ],
        },
      }),
    );
    doctorContext.buildForDoctorId.mockResolvedValue(
      contexto({
        doctor: { id: 'owner-1', ownerId: 'owner-1', name: 'Dono' },
      }),
    );
    const dados = await service.montarDados('owner-1', 'pay-1', {
      emitidoPor: 'owner-1',
      agora,
    });
    expect(dados.doctorSignatureUrl).toBeUndefined();
  });

  it('registra cada emissão do PDF com quem, qual pagamento e se saiu assinado', async () => {
    const { service, emissoes } = montar();
    await service.pdf('owner-1', 'doc-1', 'pay-1');
    await service.pdf('owner-1', 'recepcao-1', 'pay-1');
    expect(emissoes.register).toHaveBeenNthCalledWith(1, {
      ownerId: 'owner-1',
      paymentId: 'pay-1',
      issuedById: 'doc-1',
      withSignature: true,
    });
    expect(emissoes.register).toHaveBeenNthCalledWith(2, {
      ownerId: 'owner-1',
      paymentId: 'pay-1',
      issuedById: 'recepcao-1',
      withSignature: false,
    });
  });

  it('prévia não registra emissão', async () => {
    const { service, emissoes } = montar();
    await service.preview('owner-1', 'doc-1', 'pay-1');
    expect(emissoes.register).not.toHaveBeenCalled();
  });

  it('sem executante usa o dono da conta e funciona sem cabeçalho', async () => {
    const { repo, service, doctorContext } = montar();
    repo.dadosDoRecibo.mockResolvedValue(
      pagamento({
        method: PaymentMethod.PIX,
        installments: 1,
        cardBrand: null,
        refundedAmount: '10.00',
        receivable: {
          id: 'rec-1',
          ownerId: 'owner-1',
          patient: { id: 'pat-1', name: 'Ana Souza', cpf: null },
          items: [
            {
              id: 'i-1',
              description: 'Consulta',
              executedById: null,
              cancelledAt: null,
            },
          ],
        },
      }),
    );
    doctorContext.buildForDoctorId.mockResolvedValue(
      contexto({
        doctor: { id: 'owner-1', ownerId: 'owner-1', name: 'Clínica X' },
        profile: null,
        doctorCrm: undefined,
        doctorSignatureUrl: undefined,
        customHeader: null,
      }),
    );

    const dados = await service.montarDados('owner-1', 'pay-1', { agora });

    expect(doctorContext.buildForDoctorId).toHaveBeenCalledWith('owner-1');
    expect(dados.customHeader).toBeNull();
    expect(dados.patientCpf).toBeUndefined();
    expect(dados.paymentMethod).toBe('PIX');
    expect(dados.refundedAmount).toBe('R$ 10,00');
    expect(dados.placeAndDate).toBe('20/10/2026');
    expect(dados.showPlaceAndDate).toBe(false);
    expect(dados.doctorName).toBe('Clínica X');
  });

  it('executante de outro tenant ou inexistente cai para o dono da conta', async () => {
    const { service, doctorContext } = montar();
    doctorContext.buildForDoctorId
      .mockResolvedValueOnce(
        contexto({
          doctor: { id: 'doc-1', ownerId: 'outro', name: 'Intruso' },
        }),
      )
      .mockResolvedValueOnce(contexto());

    await service.montarDados('owner-1', 'pay-1', { agora });
    expect(doctorContext.buildForDoctorId).toHaveBeenNthCalledWith(
      2,
      'owner-1',
    );

    doctorContext.buildForDoctorId
      .mockRejectedValueOnce(new Error('Médico não encontrado'))
      .mockResolvedValueOnce(contexto());
    const dados = await service.montarDados('owner-1', 'pay-1', { agora });
    expect(doctorContext.buildForDoctorId).toHaveBeenLastCalledWith('owner-1');
    expect(dados.doctorName).toBe('Dr. Fabio');
  });

  it('sem itens ativos descreve como serviços prestados', async () => {
    const { repo, service } = montar();
    repo.dadosDoRecibo.mockResolvedValue(
      pagamento({
        receivable: {
          id: 'rec-1',
          ownerId: 'owner-1',
          patient: { id: 'pat-1', name: 'Ana', cpf: null },
          items: [],
        },
      }),
    );
    const dados = await service.montarDados('owner-1', 'pay-1', { agora });
    expect(dados.description).toBe('serviços prestados');
  });

  it('prévia e PDF usam a mesma montagem e o mesmo template', async () => {
    const { service, pdfService } = montar();

    await expect(service.preview('owner-1', 'doc-1', 'pay-1')).resolves.toBe(
      '<html></html>',
    );
    await service.pdf('owner-1', 'doc-1', 'pay-1');

    const [template, dadosDaPrevia] =
      pdfService.renderClinicalDocumentHtml.mock.calls[0];
    const [dadosDoPdf] = pdfService.generateReceiptPdf.mock.calls[0];
    expect(template).toBe('receipt');
    expect({ ...dadosDaPrevia, today: '', placeAndDate: '' }).toEqual({
      ...dadosDoPdf,
      today: '',
      placeAndDate: '',
    });
  });
});

describe('helpers do recibo', () => {
  it.each([
    [
      { method: PaymentMethod.CASH, installments: 1, cardBrand: null },
      'Dinheiro',
    ],
    [
      {
        method: PaymentMethod.CREDIT_CARD,
        installments: 1,
        cardBrand: 'Master',
      },
      'Cartão de crédito (Master)',
    ],
    [
      { method: PaymentMethod.CREDIT_CARD, installments: 10, cardBrand: null },
      'Cartão de crédito em 10x',
    ],
  ])('forma %p → %p', (payment, esperado) => {
    expect(descreverFormaDePagamento(payment)).toBe(esperado);
  });

  it('local e data usa cidade/UF quando houver', () => {
    expect(localEData({ city: 'Recife', state: null }, agora)).toBe(
      'Recife, 20/10/2026',
    );
    expect(localEData(null, agora)).toBe('20/10/2026');
  });
});
