import { sanitizeTemplateData } from './surgery-request-template-data';

/**
 * O `templateData` era gravado como `object` cru: o que o frontend mandasse,
 * entrava. O `SendRequestModal` despejava a SC inteira ali dentro —
 * `authorizedQuantity`, os `id` dos itens da SC de origem e o marcador de
 * sistema `sc_creation_source` no lugar de um documento exigido.
 */
describe('sanitizeTemplateData', () => {
  it('mantém procedimento, hospital e convênio apenas com id e nome', () => {
    const data = sanitizeTemplateData({
      procedure: {
        id: 'd1b2f711-3fd1-4e99-813c-e35b021714fa',
        name: 'Apendicectomia laparoscópica',
        createdAt: '2026-01-01',
        ownerId: 'algum-owner',
      },
      hospital: {
        id: 'd1e38ec1-7008-40ba-8e4c-7fff8cdbdf2d',
        name: "Hospital Caxias D' or",
        cnpj: '00.000.000/0001-00',
      },
      healthPlan: {
        id: 'c15d874f-5113-45fe-bc8b-2c997a659abf',
        name: 'SULAMERICA',
        ansCode: '123',
      },
    });

    expect(data.procedure).toEqual({
      id: 'd1b2f711-3fd1-4e99-813c-e35b021714fa',
      name: 'Apendicectomia laparoscópica',
    });
    expect(data.hospital).toEqual({
      id: 'd1e38ec1-7008-40ba-8e4c-7fff8cdbdf2d',
      name: "Hospital Caxias D' or",
    });
    expect(data.healthPlan).toEqual({
      id: 'c15d874f-5113-45fe-bc8b-2c997a659abf',
      name: 'SULAMERICA',
    });
  });

  it('descarta os hospitalId/healthPlanId soltos, redundantes com os objetos', () => {
    const data = sanitizeTemplateData({
      hospital: { id: 'h1', name: 'Hospital' },
      hospitalId: 'h1',
      healthPlan: { id: 'c1', name: 'Convênio' },
      healthPlanId: 'c1',
    });

    expect(data).not.toHaveProperty('hospitalId');
    expect(data).not.toHaveProperty('healthPlanId');
  });

  it('preserva procedureName para o modelo criado sem procedimento do catálogo', () => {
    const data = sanitizeTemplateData({
      procedure: null,
      procedureName: 'Artrodese de coluna',
    });

    expect(data.procedure).toBeUndefined();
    expect(data.procedureName).toBe('Artrodese de coluna');
  });

  it('guarda a prioridade do modelo', () => {
    expect(sanitizeTemplateData({ priority: 3 }).priority).toBe(3);
    expect(sanitizeTemplateData({ priority: 99 }).priority).toBeUndefined();
    expect(sanitizeTemplateData({}).priority).toBeUndefined();
  });

  it('limpa os itens TUSS das sobras da SC de origem', () => {
    const data = sanitizeTemplateData({
      tussItems: [
        {
          id: 'e0883246-7d26-40b4-adec-4a1e6f40d39f',
          surgeryRequestId: '2929e2dc-a5d1-42d8-b306-31dc8b01619e',
          tussCode: '3.07.15.09-1',
          name: 'Descompressão de cauda equina',
          quantity: 2,
          authorizedQuantity: null,
        },
      ],
    });

    expect(data.tussItems).toEqual([
      {
        tussCode: '3.07.15.09-1',
        name: 'Descompressão de cauda equina',
        quantity: 2,
      },
    ]);
  });

  it('reduz fabricantes e fornecedores do OPME a nomes', () => {
    const data = sanitizeTemplateData({
      opmeItems: [
        {
          id: '48701b3e-f112-495c-b79f-02ffc42f8ff6',
          name: 'Kit para endoscopia lombar',
          quantity: 1,
          description: null,
          authorizedQuantity: null,
          manufacturers: [{ name: 'Outros' }],
          suppliers: [
            { id: 'a6511379-f25c-4cf3-a601-b56149614c87', name: 'Sintex' },
            'BW Medic',
          ],
        },
      ],
    });

    expect(data.opmeItems).toEqual([
      {
        name: 'Kit para endoscopia lombar',
        quantity: 1,
        manufacturers: ['Outros'],
        suppliers: ['Sintex', 'BW Medic'],
      },
    ]);
  });

  it('descarta marcadores de sistema dos documentos exigidos', () => {
    const data = sanitizeTemplateData({
      requiredDocuments: [
        { type: 'exam_report', name: 'Ressonância' },
        {
          type: 'sc_creation_source',
          name: '44b46b13-5958-4e50-8f29-be3bace86672.pdf',
        },
      ],
    });

    expect(data.requiredDocuments).toEqual([
      { type: 'exam_report', name: 'Ressonância' },
    ]);
  });

  it('aceita a chave legada `procedures` como fonte dos itens TUSS', () => {
    const data = sanitizeTemplateData({
      procedures: [{ tussCode: '3.07.15.19-9', name: 'Hemilaminectomia' }],
    });

    expect(data.tussItems).toEqual([
      { tussCode: '3.07.15.19-9', name: 'Hemilaminectomia', quantity: 1 },
    ]);
    expect(data).not.toHaveProperty('procedures');
  });

  it('descarta itens sem os campos que os identificam', () => {
    const data = sanitizeTemplateData({
      tussItems: [{ name: 'Sem código', quantity: 1 }, 'lixo', null],
      opmeItems: [{ quantity: 2 }],
      requiredDocuments: [{ name: 'Sem tipo' }],
    });

    expect(data.tussItems).toBeUndefined();
    expect(data.opmeItems).toBeUndefined();
    expect(data.requiredDocuments).toBeUndefined();
  });

  it('devolve objeto vazio para entrada que não é objeto', () => {
    expect(sanitizeTemplateData(null)).toEqual({});
    expect(sanitizeTemplateData('texto')).toEqual({});
  });

  it('não deixa passar nenhuma chave fora do formato', () => {
    const data = sanitizeTemplateData({
      procedure: { id: 'p1', name: 'Procedimento' },
      observacoesInternas: 'campo inventado',
      patient: { id: 'x', name: 'Paciente', cpf: '000' },
    });

    expect(Object.keys(data)).toEqual(['procedure']);
  });
});
