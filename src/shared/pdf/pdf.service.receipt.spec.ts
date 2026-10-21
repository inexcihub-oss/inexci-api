import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PdfService, ReceiptPdfData } from './pdf.service';

describe('PdfService — recibo', () => {
  let service: PdfService;
  let htmlToPdf: jest.SpyInstance;

  const base: ReceiptPdfData = {
    today: '20/10/2026',
    patientName: 'Ana <b>Souza</b>',
    patientCpf: '146.858.546-08',
    amount: 'R$ 1.234,56',
    amountInWords:
      'mil duzentos e trinta e quatro reais e cinquenta e seis centavos',
    description: 'Consulta, Infiltração',
    paymentMethod: 'Cartão de crédito em 3x (Visa)',
    paidAt: '20/10/2026',
    placeAndDate: 'Belo Horizonte/MG, 20/10/2026',
    showPlaceAndDate: true,
    doctorName: 'Dr. Fabio',
    doctorCrm: 'CRM 12345/MG',
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PdfService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get(PdfService);
    htmlToPdf = jest
      .spyOn(service as any, 'htmlToPdf')
      .mockResolvedValue(Buffer.from('pdf'));
  });

  it('sem cabeçalho usa o título padrão e imprime o texto do recibo', async () => {
    const html = await service.renderClinicalDocumentHtml('receipt', base);

    expect(html).toContain("class='page-header'");
    expect(html).toContain('RECIBO');
    expect(html).toContain(
      'Recebi de <strong>Ana &lt;b&gt;Souza&lt;/b&gt;</strong>, CPF 146.858.546-08,',
    );
    expect(html).toContain('a importância de <strong>R$ 1.234,56</strong>');
    expect(html).toContain(
      '(mil duzentos e trinta e quatro reais e cinquenta e seis centavos)',
    );
    expect(html).toContain('referente a Consulta, Infiltração.');
    expect(html).toContain('Cartão de crédito em 3x (Visa)');
    expect(html).toContain('Belo Horizonte/MG, 20/10/2026');
    expect(html).toContain('Dr. Fabio');
    expect(html).toContain('CRM 12345/MG');
    expect(html).not.toContain('Valor estornado');
    expect(html).toContain(
      "<span class='section-title'>Dados do pagamento</span>",
    );
    expect(html).toContain("<span class='patient-label'>Recebido de:</span>");
    expect(html).not.toContain('receipt-amount');
  });

  it('sem cidade e sem cabeçalho próprio não repete a data do cabeçalho', async () => {
    const semLocal: ReceiptPdfData = {
      ...base,
      placeAndDate: '20/10/2026',
      showPlaceAndDate: false,
    };
    const html = await service.renderClinicalDocumentHtml('receipt', semLocal);

    expect(html.match(/20\/10\/2026/g)).toHaveLength(2);
    expect(html).toContain('Data: 20/10/2026');
  });

  it('com cabeçalho do médico usa logo e conteúdo customizados', async () => {
    const dados: ReceiptPdfData = {
      ...base,
      patientCpf: undefined,
      refundedAmount: 'R$ 10,00',
      customHeader: {
        logoUrl: 'data:image/png;base64,AAA',
        logoPosition: 'center',
        contentHtml: '<p>Clínica Ortopédica</p>',
      },
    };
    const html = await service.renderClinicalDocumentHtml('receipt', dados);

    expect(html).toContain('custom-header--center');
    expect(html).toContain('data:image/png;base64,AAA');
    expect(html).toContain('<p>Clínica Ortopédica</p>');
    expect(html).not.toContain("class='page-header'");
    expect(html).not.toContain('CPF');
    expect(html).toContain('Valor estornado');
    expect(html).toContain('R$ 10,00');
  });

  it('gera o PDF a partir do mesmo template', async () => {
    const pdf = await service.generateReceiptPdf(base);
    expect(pdf.toString()).toBe('pdf');
    expect(htmlToPdf.mock.calls[0][0]).toContain('Recebi de');
  });
});
