import { PendencyKeys } from '.';

export default {
  pending: {
    value: 1,
    defaultPendencies: [
      {
        name: 'Preencher dados',
        description: 'Preencha todos os dados obrigatórios da solicitação',
        key: PendencyKeys.completeFields,
      },
      {
        name: 'Selecionar fornecedores',
        description: 'Selecione no mínimo 3 fornecedores',
        key: PendencyKeys.selectSuppliers,
      },
      {
        name: 'Preencher TUSS',
        description: 'Preencha o(s) código(s) TUSS',
        key: PendencyKeys.insertTuss,
      },
      {
        name: 'Preencher OPME',
        description: 'Preencha os itens da lista OPME',
        key: PendencyKeys.insertOpme,
      },
      {
        name: 'Inserir documento',
        description: 'Inserir CNH ou RG do paciente',
        key: PendencyKeys.documents.personalDocument,
      },
      {
        name: 'Inserir documento',
        description: 'Inserir o laudo RNM',
        key: PendencyKeys.documents.rnmReport,
      },
      {
        name: 'Inserir documento',
        description: 'Inserir o pedido médico',
        key: PendencyKeys.documents.doctorRequest,
      },
    ],
  },
  sent: {
    value: 2,
    defaultPendencies: [
      {
        name: 'Anexar cotações',
        description:
          'Anexe no mínimo 3 cotações com nº de proposta e data de envio',
        key: 'insert_quotations',
      },
    ],
  },
  inAnalysis: {
    value: 3,
    defaultPendencies: [],
  },
  inReanalysis: {
    value: 4,
    defaultPendencies: [],
  },
  awaitingAppointment: {
    value: 5,
    defaultPendencies: [],
  },
  scheduled: {
    value: 6,
    defaultPendencies: [
      {
        name: 'Guia de autorização',
        description: 'Inserir a Guia de Autorização da cirurgia',
        key: PendencyKeys.documents.authorizationGuide,
      },
    ],
  },
  toInvoice: {
    value: 7,
    defaultPendencies: [],
  },
  invoiced: {
    value: 8,
    defaultPendencies: [],
  },
  received: {
    value: 9,
    defaultPendencies: [],
  },
  canceled: {
    value: 10,
    defaultPendencies: [],
  },
};
