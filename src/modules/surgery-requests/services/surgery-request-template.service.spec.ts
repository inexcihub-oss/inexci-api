import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SurgeryRequestTemplateService } from './surgery-request-template.service';

const OWNER_ID = '50430d6f-def2-4423-9324-36c91f9784a8';
const USER_ID = OWNER_ID;
const TEMPLATE_ID = '0c8398bd-fbd6-45da-904e-c23abc37183b';

const templateCompleto = {
  id: TEMPLATE_ID,
  name: 'Modelo - Coluna',
  usageCount: 1,
  createdAt: new Date('2026-08-08T06:25:56.810Z'),
  updatedAt: new Date('2026-08-08T06:26:28.608Z'),
  doctor: { name: 'Dr. Fulano' },
  templateData: {
    procedure: { id: 'p1', name: 'Apendicectomia laparoscópica' },
    hospital: { id: 'h1', name: "Hospital Caxias D' or" },
    healthPlan: { id: 'c1', name: 'SULAMERICA' },
    priority: 3,
    tussItems: [
      { tussCode: '3.07.15.09-1', name: 'Cauda equina', quantity: 2 },
    ],
  },
};

function criarService() {
  const repo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((v: unknown) => v),
    save: jest.fn((v: Record<string, unknown>) => ({ ...v, id: TEMPLATE_ID })),
  };
  const dataSource = { getRepository: () => repo } as unknown as DataSource;
  return { service: new SurgeryRequestTemplateService(dataSource), repo };
}

describe('SurgeryRequestTemplateService', () => {
  describe('getTemplates', () => {
    /**
     * A listagem alimenta duas telas que só pintam texto (o seletor do wizard e
     * a tabela de Procedimentos). Devolver o `templateData` inteiro e o objeto
     * `User` do médico — 24 campos, incluindo cpf, telefone e endereço — era
     * tráfego e dado pessoal sem uso nenhum.
     */
    it('devolve o resumo, sem templateData e sem o objeto do médico', async () => {
      const { service, repo } = criarService();
      repo.find.mockResolvedValue([templateCompleto]);

      const [resumo] = await service.getTemplates(USER_ID, OWNER_ID);

      expect(resumo).toEqual({
        id: TEMPLATE_ID,
        name: 'Modelo - Coluna',
        procedureId: 'p1',
        procedureName: 'Apendicectomia laparoscópica',
        hospitalId: 'h1',
        hospitalName: "Hospital Caxias D' or",
        healthPlanId: 'c1',
        healthPlanName: 'SULAMERICA',
        priority: 3,
        doctorName: 'Dr. Fulano',
        usageCount: 1,
        createdAt: templateCompleto.createdAt,
        updatedAt: templateCompleto.updatedAt,
      });
    });

    it('busca apenas as colunas do resumo e o nome do médico', async () => {
      const { service, repo } = criarService();
      repo.find.mockResolvedValue([]);

      await service.getTemplates(USER_ID, OWNER_ID);

      const select = repo.find.mock.calls[0][0].select;
      expect(select.doctor).toEqual({ name: true });
      expect(select.templateData).toBe(true);
    });

    it('cai no procedureName quando o modelo não tem procedimento do catálogo', async () => {
      const { service, repo } = criarService();
      repo.find.mockResolvedValue([
        {
          ...templateCompleto,
          doctor: null,
          templateData: { procedureName: 'Artrodese' },
        },
      ]);

      const [resumo] = await service.getTemplates(USER_ID, OWNER_ID);

      expect(resumo.procedureName).toBe('Artrodese');
      expect(resumo.procedureId).toBeNull();
      expect(resumo.hospitalName).toBeNull();
      expect(resumo.doctorName).toBeNull();
    });
  });

  describe('getTemplate', () => {
    it('devolve o modelo completo com templateData', async () => {
      const { service, repo } = criarService();
      repo.findOne.mockResolvedValue(templateCompleto);

      const template = await service.getTemplate(
        TEMPLATE_ID,
        USER_ID,
        OWNER_ID,
      );

      expect(template.templateData).toEqual(templateCompleto.templateData);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: TEMPLATE_ID, doctorId: USER_ID, ownerId: OWNER_ID },
      });
    });

    it('recusa modelo de outro dono', async () => {
      const { service, repo } = criarService();
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.getTemplate(TEMPLATE_ID, USER_ID, OWNER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('saneamento na gravação', () => {
    it('descarta as sobras da SC ao criar', async () => {
      const { service, repo } = criarService();
      repo.findOne.mockResolvedValue({ id: TEMPLATE_ID });

      await service.createTemplate(
        {
          name: 'Modelo',
          templateData: {
            procedure: { id: 'p1', name: 'Procedimento', ownerId: 'x' },
            patient: { id: 'pac', name: 'Paciente', cpf: '000' },
            tussItems: [
              { id: 'item-da-sc', tussCode: '1', name: 'T', quantity: 1 },
            ],
          },
        },
        USER_ID,
        OWNER_ID,
      );

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          templateData: {
            procedure: { id: 'p1', name: 'Procedimento' },
            tussItems: [{ tussCode: '1', name: 'T', quantity: 1 }],
          },
        }),
      );
    });

    it('sane ia também na atualização', async () => {
      const { service, repo } = criarService();
      repo.findOne.mockResolvedValue({ id: TEMPLATE_ID, name: 'Antigo' });

      await service.updateTemplate(
        TEMPLATE_ID,
        {
          templateData: {
            hospital: { id: 'h1', name: 'Hospital', cnpj: '000' },
            requiredDocuments: [
              { type: 'sc_creation_source', name: 'arquivo.pdf' },
            ],
          },
        },
        USER_ID,
        OWNER_ID,
      );

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          templateData: { hospital: { id: 'h1', name: 'Hospital' } },
        }),
      );
    });

    it('não toca no templateData quando a atualização é só de nome', async () => {
      const { service, repo } = criarService();
      const existente = {
        id: TEMPLATE_ID,
        name: 'Antigo',
        templateData: { procedure: { id: 'p1', name: 'Procedimento' } },
      };
      repo.findOne.mockResolvedValue(existente);

      await service.updateTemplate(
        TEMPLATE_ID,
        { name: 'Novo nome' },
        USER_ID,
        OWNER_ID,
      );

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Novo nome',
          templateData: existente.templateData,
        }),
      );
    });
  });
});
