import {
  mapDetailDoctor,
  mapSurgeryRequestDetail,
} from './surgery-request-detail.mapper';

describe('mapDetailDoctor', () => {
  it('retorna null quando não há médico', () => {
    expect(mapDetailDoctor(null)).toBeNull();
    expect(mapDetailDoctor(undefined)).toBeNull();
  });

  it('reduz o médico ao contrato DoctorRef preservando o header do laudo', () => {
    const result = mapDetailDoctor({
      id: 'd-1',
      name: 'Dra. Ana',
      avatarUrl: 'avatar.png',
      email: 'ana@x.com',
      phone: '11999999999',
      signatureUrl: 'signed-sig',
      doctorProfile: {
        crm: '12345',
        crmState: 'SP',
        specialty: 'Ortopedia',
        signatureUrl: 'sig-path',
        header: {
          id: 'h-1',
          logoUrl: 'signed-logo',
          logoPosition: 'center',
          contentHtml: '<p>Cabeçalho</p>',
        },
      },
    });

    expect(result).toEqual({
      id: 'd-1',
      name: 'Dra. Ana',
      avatarUrl: 'avatar.png',
      email: 'ana@x.com',
      phone: '11999999999',
      signatureUrl: 'signed-sig',
      doctorProfile: {
        crm: '12345',
        crmState: 'SP',
        specialty: 'Ortopedia',
        signatureUrl: 'sig-path',
        header: {
          id: 'h-1',
          logoUrl: 'signed-logo',
          logoPosition: 'center',
          contentHtml: '<p>Cabeçalho</p>',
        },
      },
    });
  });

  it('não vaza colunas extras presentes na entidade', () => {
    const entityLike = {
      id: 'd-1',
      name: 'Dr. B',
      password: 'hash',
      createdAt: '2026-01-01',
      doctorProfile: { crm: '1', crmState: 'RJ' },
    } as unknown as Parameters<typeof mapDetailDoctor>[0];

    const result = mapDetailDoctor(entityLike);

    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('createdAt');
    expect(result?.doctorProfile?.header).toBeNull();
  });
});

describe('mapSurgeryRequestDetail', () => {
  const doctor = mapDetailDoctor({
    id: 'd-1',
    name: 'Dr. Test',
    doctorProfile: { crm: '1', crmState: 'SP' },
  });

  it('mapeia relações ao allowlist e remove campos internos', () => {
    const result = mapSurgeryRequestDetail(
      {
        id: 'sc-1',
        status: 3,
        priority: 2,
        protocol: '123456',
        createdAt: '2026-01-01T00:00:00.000Z',
        hasOpme: true,
        surgeryDate: '2026-02-01T10:00:00.000Z',
        surgeryPerformedAt: null,
        cidCode: 'M17.1',
        dateOptions: ['2026-02-01T10:00:00.000Z'],
        selectedDateIndex: 0,
        hospitalId: 'h-1',
        healthPlanId: 'hp-1',
        healthPlanRegistration: 'REG-1',
        healthPlanType: 'Tipo',
        surgeryDescription: 'Não deve vazar',
        observations: 'Não deve vazar',
        updatedAt: '2026-06-01',
        ownerId: 'owner-1',
        doctorId: 'd-1',
        patient: {
          id: 'p-1',
          name: 'Paciente',
          cpf: '12345678901',
          medicalNotes: 'sensível',
        },
        hospital: {
          id: 'h-1',
          name: 'Hospital X',
          address: 'Rua A',
          email: 'h@x.com',
        },
        healthPlan: { id: 'hp-1', name: 'Unimed', email: 'u@x.com' },
        procedure: { id: 'proc-1', name: 'Artroscopia' },
        tussItems: [
          {
            id: 't-1',
            name: 'Proc TUSS',
            tussCode: '30701010',
            quantity: 1,
            authorizedQuantity: 1,
            internalField: 'x',
          },
        ],
        opmeItems: [
          {
            id: 'o-1',
            name: 'OPME',
            description: 'Desc',
            quantity: 2,
            authorizedQuantity: 1,
            selectedSupplier: { id: 's-9', name: 'Forn', email: 'f@x.com' },
            suppliers: [{ id: 's-1', name: 'Forn A', phone: '111' }],
            manufacturers: [{ name: 'Fab A', cnpj: '00' }],
          },
        ],
        documents: [
          {
            id: 'doc-1',
            key: 'rg',
            name: 'RG',
            path: 'documents/rg.pdf',
            uri: 'https://signed/rg.pdf',
            createdAt: '2026-03-15T10:00:00.000Z',
            createdBy: 'user-1',
            creator: { id: 'user-1', name: 'Admin', password: 'hash' },
          },
        ],
        billing: {
          invoiceValue: 1000,
          invoiceProtocol: 'PROT-1',
          invoiceSentAt: '2026-03-01',
          invoiceNotes: 'Nota',
          paymentDeadline: '2026-04-01',
          receivedValue: 500,
        },
        analysis: { authorized: true, extra: 'ok' },
        contestations: [{ id: 'c-1', type: 'AUTHORIZATION' }],
      } as any,
      doctor,
      { receivedValue: 500, is_contested: false },
    );

    expect(result).toMatchObject({
      id: 'sc-1',
      status: 3,
      patient: { id: 'p-1', name: 'Paciente', cpf: '12345678901' },
      hospital: { id: 'h-1', name: 'Hospital X' },
      healthPlan: { id: 'hp-1', name: 'Unimed' },
      procedure: { id: 'proc-1', name: 'Artroscopia' },
      tussItems: [
        {
          id: 't-1',
          name: 'Proc TUSS',
          tussCode: '30701010',
          quantity: 1,
          authorizedQuantity: 1,
        },
      ],
      opmeItems: [
        {
          id: 'o-1',
          suppliers: [{ id: 's-1', name: 'Forn A' }],
          manufacturers: [{ name: 'Fab A' }],
        },
      ],
      documents: [
        {
          id: 'doc-1',
          key: 'rg',
          uri: 'https://signed/rg.pdf',
          createdAt: '2026-03-15T10:00:00.000Z',
          createdBy: 'user-1',
        },
      ],
      billing: {
        invoiceValue: 1000,
        invoiceProtocol: 'PROT-1',
      },
      analysis: { authorized: true, extra: 'ok' },
      contestations: [{ id: 'c-1', type: 'AUTHORIZATION' }],
      doctor,
      receipt: { receivedValue: 500, is_contested: false },
    });

    expect(result).not.toHaveProperty('surgeryDescription');
    expect(result).not.toHaveProperty('diagnosis');
    expect(result).not.toHaveProperty('medicalReport');
    expect(result).not.toHaveProperty('patientHistory');
    expect(result).not.toHaveProperty('cidId');
    expect(result).not.toHaveProperty('cidCode');
    expect(result).not.toHaveProperty('cidDescription');
    expect(result).not.toHaveProperty('observations');
    expect(result).not.toHaveProperty('updatedAt');
    expect(result).not.toHaveProperty('ownerId');
    expect(result.patient).toEqual({
      id: 'p-1',
      name: 'Paciente',
      cpf: '12345678901',
    });
    expect(result.patient).not.toHaveProperty('medicalNotes');
    expect(result.hospital).not.toHaveProperty('address');
    expect(result.hospital).not.toHaveProperty('email');
    expect(result.opmeItems[0]).not.toHaveProperty('selectedSupplier');
    expect(result.documents[0]).not.toHaveProperty('creator');
    expect(result.billing).not.toHaveProperty('receivedValue');
    expect(result.tussItems[0]).not.toHaveProperty('internalField');
  });

  it('tolera relações ausentes ou arrays vazios', () => {
    const result = mapSurgeryRequestDetail(
      { id: 'sc-2', status: 1 } as any,
      null,
      null,
    );

    expect(result.patient).toBeNull();
    expect(result.hospital).toBeNull();
    expect(result.tussItems).toEqual([]);
    expect(result.opmeItems).toEqual([]);
    expect(result.documents).toEqual([]);
    expect(result.billing).toBeNull();
    expect(result.contestations).toEqual([]);
    expect(result.doctor).toBeNull();
    expect(result.receipt).toBeNull();
    expect(result.cid).toBeNull();
  });

  it('inclui CID unificado quando resolvido no catálogo', () => {
    const result = mapSurgeryRequestDetail(
      { id: 'sc-3', status: 1, cidCode: 'A000' } as any,
      null,
      null,
      {
        id: 'A000',
        code: 'A000',
        description: 'Cólera Devida a Vibrio Cholerae 01, Biótipo Cholerae',
      },
    );

    expect(result.cid).toEqual({
      code: 'A000',
      description: 'Cólera Devida a Vibrio Cholerae 01, Biótipo Cholerae',
    });
  });

  it('expõe campos do paciente necessários para identificação no laudo', () => {
    const result = mapSurgeryRequestDetail(
      {
        id: 'sc-4',
        status: 1,
        patient: {
          id: 'p-2',
          name: 'Patrícia Gonçalves Ferraz',
          cpf: '70271775106',
          birthDate: new Date('1988-10-07T00:00:00.000Z'),
          phone: '11965004444',
          address: 'Rua das Flores',
          addressNumber: '123',
          neighborhood: 'Centro',
          city: 'São Paulo',
          state: 'SP',
          zipCode: '01310100',
          medicalNotes: 'notas sensíveis',
        },
      } as any,
      null,
      null,
    );

    expect(result.patient).toEqual({
      id: 'p-2',
      name: 'Patrícia Gonçalves Ferraz',
      cpf: '70271775106',
      birthDate: '1988-10-07',
      phone: '11965004444',
      address: 'Rua das Flores, 123, Centro, São Paulo, SP',
      zipCode: '01310100',
    });
    expect(result.patient).not.toHaveProperty('medicalNotes');
  });
});
