import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PdfService } from './pdf.service';

/**
 * Os três documentos do atendimento (receita, atestado e encaminhamento de
 * exames) são renderizados a partir dos templates `.hbs` reais — o Puppeteer é
 * substituído por um spy, então o que se verifica aqui é o HTML final.
 */
describe('PdfService — documentos do atendimento', () => {
  let service: PdfService;
  let htmlToPdf: jest.SpyInstance;

  const doctor = {
    doctorName: 'Dra. Ana Souza',
    doctorCrm: 'CRM 12345/RJ',
    doctorSpecialty: 'Ortopedia',
  };

  const patient = {
    patientName: 'Alessandro Filho',
    patientBirthDate: '10/03/1985',
    patientCpf: '146.858.546-08',
  };

  const renderedHtml = () => htmlToPdf.mock.calls[0][0] as string;

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

  describe('receita', () => {
    const baseData = {
      today: '30/07/2026',
      ...patient,
      ...doctor,
      items: [
        {
          name: 'Dipirona 500mg',
          quantity: '1 caixa',
          instructions: 'Tomar 1 comprimido a cada 6 horas por 3 dias',
        },
        { name: 'Omeprazol 20mg', quantity: '30 comprimidos' },
      ],
    };

    it('imprime cada medicamento com quantidade e posologia', async () => {
      await service.generatePrescriptionPdf(baseData as any);
      const html = renderedHtml();

      expect(html).toContain('Dipirona 500mg');
      expect(html).toContain('1 caixa');
      expect(html).toContain('Tomar 1 comprimido a cada 6 horas por 3 dias');
      expect(html).toContain('Omeprazol 20mg');
    });

    it('identifica o paciente e o médico responsável', async () => {
      await service.generatePrescriptionPdf(baseData as any);
      const html = renderedHtml();

      expect(html).toContain('Alessandro Filho');
      expect(html).toContain('Dra. Ana Souza');
      expect(html).toContain('CRM 12345/RJ');
      expect(html).toContain('30/07/2026');
    });

    it('escapa HTML vindo do texto livre do médico', async () => {
      await service.generatePrescriptionPdf({
        ...baseData,
        notes: '<script>alert(1)</script>',
      } as any);

      expect(renderedHtml()).not.toContain('<script>alert(1)</script>');
    });
  });

  describe('atestado', () => {
    const baseData = {
      today: '30/07/2026',
      ...patient,
      ...doctor,
      restDays: 3,
      restDaysLabel: '3 dias',
      startDate: '30/07/2026',
    };

    it('declara o período de afastamento', async () => {
      await service.generateMedicalCertificatePdf(baseData as any);
      const html = renderedHtml();

      expect(html).toContain('Alessandro Filho');
      expect(html).toContain('3 dias');
      expect(html).toContain('30/07/2026');
    });

    it('inclui o CID somente quando informado', async () => {
      await service.generateMedicalCertificatePdf(baseData as any);
      expect(renderedHtml()).not.toContain('CID');

      htmlToPdf.mockClear();
      await service.generateMedicalCertificatePdf({
        ...baseData,
        cid: { code: 'M54.5', description: 'Dor lombar baixa' },
      } as any);

      const html = renderedHtml();
      expect(html).toContain('M54.5');
      expect(html).toContain('Dor lombar baixa');
    });
  });

  describe('encaminhamento de exames', () => {
    const baseData = {
      today: '30/07/2026',
      ...patient,
      ...doctor,
      patientHealthPlan: 'Hapvida',
      patientHealthPlanNumber: '9988776655',
      exams: [
        {
          name: 'Ressonância magnética de joelho direito',
          tussCode: '4.09.01.14-0',
          observation: 'Avaliar menisco medial',
        },
        { name: 'Hemograma completo' },
      ],
      clinicalIndication: 'Dor e edema em joelho direito há 3 meses.',
      cidCodes: [
        { code: 'M23.3', description: 'Outros transtornos do menisco' },
      ],
    };

    it('lista os exames solicitados com código TUSS e observação', async () => {
      await service.generateExamReferralPdf(baseData as any);
      const html = renderedHtml();

      expect(html).toContain('Ressonância magnética de joelho direito');
      expect(html).toContain('4.09.01.14-0');
      expect(html).toContain('Avaliar menisco medial');
      expect(html).toContain('Hemograma completo');
    });

    it('imprime a indicação clínica, o CID e o convênio', async () => {
      await service.generateExamReferralPdf(baseData as any);
      const html = renderedHtml();

      expect(html).toContain('Dor e edema em joelho direito há 3 meses.');
      expect(html).toContain('M23.3');
      expect(html).toContain('Hapvida');
      expect(html).toContain('9988776655');
    });
  });
});
