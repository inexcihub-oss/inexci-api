import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ClinicalDocumentTemplateKind } from 'src/database/entities/clinical-document-template.entity';
import { ClinicalDocumentTemplatesService } from './clinical-document-templates.service';

describe('ClinicalDocumentTemplatesService (MIG-06)', () => {
  const repository = {
    findByOwner: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    findOne: jest.fn(),
    incrementUsage: jest.fn(),
  };
  const access = {
    getOwnerId: jest.fn(),
    assertCanIssueClinicalDocuments: jest.fn(),
    resolveDefaultDoctorId: jest.fn(),
    canAccessDoctor: jest.fn(),
    assertCanAccessDoctorResource: jest.fn(),
    getAccessibleDoctorIds: jest.fn(),
  };
  const service = new ClinicalDocumentTemplatesService(
    repository as never,
    access as never,
  );
  const modelo = {
    id: 'tpl-1',
    ownerId: 'owner-1',
    doctorId: 'doc-1',
    kind: ClinicalDocumentTemplateKind.MEDICAL_CERTIFICATE,
    name: 'Atestado padrão',
    body: 'Atesto {{paciente.nome}}',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    access.getOwnerId.mockResolvedValue('owner-1');
    access.assertCanIssueClinicalDocuments.mockResolvedValue(undefined);
    access.resolveDefaultDoctorId.mockResolvedValue('doc-1');
    access.canAccessDoctor.mockResolvedValue(true);
    access.assertCanAccessDoctorResource.mockResolvedValue(undefined);
    access.getAccessibleDoctorIds.mockResolvedValue(['doc-1']);
    repository.findOne.mockResolvedValue(modelo);
    repository.create.mockImplementation((d: object) =>
      Promise.resolve({ id: 'novo', ...d }),
    );
    repository.update.mockImplementation((id: string, d: object) =>
      Promise.resolve({ ...modelo, ...d }),
    );
  });

  it('lista os modelos da clínica filtrando por tipo', async () => {
    repository.findByOwner.mockResolvedValue([modelo]);
    await service.findMany('doc-1', {
      kind: ClinicalDocumentTemplateKind.MEDICAL_CERTIFICATE,
    });
    expect(repository.findByOwner).toHaveBeenCalledWith('owner-1', {
      kind: ClinicalDocumentTemplateKind.MEDICAL_CERTIFICATE,
    });
  });

  it('lista só os modelos dos profissionais acessíveis ao usuário', async () => {
    access.getAccessibleDoctorIds.mockResolvedValue(['doc-1', 'doc-2']);
    repository.findByOwner.mockResolvedValue([
      modelo,
      { ...modelo, id: 'tpl-2', doctorId: 'doc-2' },
      { ...modelo, id: 'tpl-3', doctorId: 'doc-sem-vinculo' },
    ]);

    const lista = await service.findMany('col-1');

    expect(lista.map((m) => m.id)).toEqual(['tpl-1', 'tpl-2']);
  });

  it('sem nenhum profissional acessível não lista nada', async () => {
    access.getAccessibleDoctorIds.mockResolvedValue([]);
    repository.findByOwner.mockResolvedValue([modelo]);

    await expect(service.findMany('col-1')).resolves.toEqual([]);
  });

  it('filtrar por profissional fora do acesso é 403', async () => {
    await expect(
      service.findMany('doc-1', { doctorId: 'doc-sem-vinculo' }),
    ).rejects.toThrow(ForbiddenException);
    expect(repository.findByOwner).not.toHaveBeenCalled();
  });

  it('filtra por profissional acessível', async () => {
    repository.findByOwner.mockResolvedValue([modelo]);
    await expect(
      service.findMany('doc-1', { doctorId: 'doc-1' }),
    ).resolves.toEqual([modelo]);
    expect(repository.findByOwner).toHaveBeenCalledWith('owner-1', {
      doctorId: 'doc-1',
    });
  });

  it('cria o modelo para o médico padrão do usuário, com nome aparado', async () => {
    const criado = await service.create(
      {
        kind: ClinicalDocumentTemplateKind.EXAM_REFERRAL,
        name: '  Pedido de RM  ',
        body: 'Indicação: {{paciente.nome}}',
      },
      'doc-1',
    );
    expect(criado).toMatchObject({
      ownerId: 'owner-1',
      doctorId: 'doc-1',
      kind: 'exam_referral',
      name: 'Pedido de RM',
    });
  });

  it('profissional sem CRM não cria modelo', async () => {
    access.assertCanIssueClinicalDocuments.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(
      service.create(
        {
          kind: ClinicalDocumentTemplateKind.MEDICAL_CERTIFICATE,
          name: 'x',
          body: 'y',
        },
        'crn-1',
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('modelo para outro médico exige acesso a ele e que ele tenha CRM', async () => {
    await service.create(
      {
        kind: ClinicalDocumentTemplateKind.MEDICAL_CERTIFICATE,
        name: 'x',
        body: 'y',
        doctorId: 'doc-2',
      },
      'doc-1',
    );
    expect(access.canAccessDoctor).toHaveBeenCalledWith('doc-1', 'doc-2');
    expect(access.assertCanIssueClinicalDocuments).toHaveBeenCalledWith(
      'doc-2',
      { mensagem: expect.stringContaining('dentista (CRO)') },
    );

    access.canAccessDoctor.mockResolvedValue(false);
    await expect(
      service.create(
        {
          kind: ClinicalDocumentTemplateKind.MEDICAL_CERTIFICATE,
          name: 'x',
          body: 'y',
          doctorId: 'doc-3',
        },
        'doc-1',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('atualiza só o que veio e confere o acesso ao médico do modelo', async () => {
    await service.update('tpl-1', { body: 'Novo texto' }, 'doc-1');
    expect(repository.update).toHaveBeenCalledWith('tpl-1', {
      body: 'Novo texto',
    });
    expect(access.assertCanAccessDoctorResource).toHaveBeenCalledWith(
      'doc-1',
      'owner-1',
      'doc-1',
    );
  });

  it('excluir é soft delete; modelo inexistente dá 404', async () => {
    await service.delete('tpl-1', 'doc-1');
    expect(repository.softDelete).toHaveBeenCalledWith('tpl-1');

    repository.findOne.mockResolvedValue(null);
    await expect(service.delete('x', 'doc-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('secretária sem CRM não altera nem exclui', async () => {
    access.assertCanIssueClinicalDocuments.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(
      service.update('tpl-1', { name: 'x' }, 'sec-1'),
    ).rejects.toThrow(ForbiddenException);
    await expect(service.delete('tpl-1', 'sec-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.softDelete).not.toHaveBeenCalled();
  });

  describe('getForUse', () => {
    it('devolve o modelo do tipo pedido, conferindo clínica e médico', async () => {
      await expect(
        service.getForUse(
          'tpl-1',
          ClinicalDocumentTemplateKind.MEDICAL_CERTIFICATE,
          'doc-1',
          'doc-1',
        ),
      ).resolves.toBe(modelo);
      expect(access.assertCanAccessDoctorResource).toHaveBeenCalledWith(
        'doc-1',
        'owner-1',
        'doc-1',
      );
    });

    it('tipo diferente → 400; tipo nulo aceita qualquer um', async () => {
      await expect(
        service.getForUse(
          'tpl-1',
          ClinicalDocumentTemplateKind.EXAM_REFERRAL,
          'doc-1',
          'doc-1',
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.getForUse('tpl-1', null, 'doc-1', 'doc-1'),
      ).resolves.toBe(modelo);
    });

    it('modelo de outra clínica é recusado', async () => {
      access.assertCanAccessDoctorResource.mockRejectedValue(
        new ForbiddenException(),
      );
      await expect(
        service.getForUse('tpl-1', null, 'intruso', 'doc-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    // Assistente com acesso a dois médicos não põe o texto do Dr. A num
    // documento assinado pelo Dr. B.
    it('modelo de outro profissional que não o que assina → 400', async () => {
      await expect(
        service.getForUse('tpl-1', null, 'assistente', 'doc-2'),
      ).rejects.toThrow(/outro profissional/);
    });
  });
});
