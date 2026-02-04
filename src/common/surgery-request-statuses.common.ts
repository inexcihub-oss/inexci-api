import { PendencyKeys } from '.';

// Tipos de responsável para pendências
export type PendencyResponsible = 'collaborator' | 'patient' | 'doctor';

export interface DefaultPendency {
  name: string;
  description: string;
  key: string;
  responsible: PendencyResponsible;
  optional?: boolean;
  isWaiting?: boolean; // Pendência de "aguardar" (não requer ação imediata)
}

export interface StatusConfig {
  value: number;
  label: string;
  defaultPendencies: DefaultPendency[];
  nextStatus?: number; // Status para qual deve avançar quando todas pendências forem concluídas
}

const statuses: Record<string, StatusConfig> = {
  pending: {
    value: 1,
    label: 'Pendente',
    nextStatus: 2, // Enviada
    defaultPendencies: [
      {
        name: 'Dados do Paciente',
        description: 'Preencher nome, email e telefone do paciente',
        key: PendencyKeys.patientData,
        responsible: 'collaborator',
      },
      {
        name: 'Dados do Hospital',
        description: 'Selecionar o hospital',
        key: PendencyKeys.hospitalData,
        responsible: 'collaborator',
      },
      {
        name: 'Dados do Plano',
        description: 'Selecionar plano de saúde e preencher matrícula',
        key: PendencyKeys.healthPlanData,
        responsible: 'collaborator',
      },
      {
        name: 'Procedimentos TUSS',
        description: 'Inserir pelo menos 1 código TUSS',
        key: PendencyKeys.insertTuss,
        responsible: 'collaborator',
      },
      {
        name: 'Itens OPME',
        description: 'Inserir itens OPME (se aplicável)',
        key: PendencyKeys.insertOpme,
        responsible: 'collaborator',
      },
      {
        name: 'Diagnóstico (CID)',
        description: 'Inserir código CID e diagnóstico',
        key: PendencyKeys.diagnosisData,
        responsible: 'collaborator',
      },
      {
        name: 'Laudo Médico',
        description: 'Preencher ou anexar laudo médico',
        key: PendencyKeys.medicalReport,
        responsible: 'collaborator',
      },
      {
        name: 'RG/CNH do Paciente',
        description: 'Anexar documento de identificação',
        key: PendencyKeys.documents.personalDocument,
        responsible: 'collaborator',
      },
      {
        name: 'Pedido Médico',
        description: 'Anexar pedido médico assinado',
        key: PendencyKeys.documents.doctorRequest,
        responsible: 'collaborator',
      },
    ],
  },
  sent: {
    value: 2,
    label: 'Enviada',
    nextStatus: 3, // Em Análise
    defaultPendencies: [
      {
        name: 'Cotação 1',
        description: 'Preencher cotação do fornecedor 1',
        key: PendencyKeys.quotation1,
        responsible: 'collaborator',
      },
      {
        name: 'Cotação 2',
        description: 'Preencher cotação do fornecedor 2',
        key: PendencyKeys.quotation2,
        responsible: 'collaborator',
      },
      {
        name: 'Cotação 3',
        description: 'Preencher cotação do fornecedor 3',
        key: PendencyKeys.quotation3,
        responsible: 'collaborator',
      },
      {
        name: 'Protocolo Hospital',
        description: 'Registrar número do protocolo do hospital',
        key: PendencyKeys.hospitalProtocol,
        responsible: 'collaborator',
      },
      {
        name: 'Protocolo Convênio',
        description: 'Registrar número do protocolo do convênio',
        key: PendencyKeys.healthPlanProtocol,
        responsible: 'collaborator',
      },
    ],
  },
  inAnalysis: {
    value: 3,
    label: 'Em Análise',
    nextStatus: 4, // Em Agendamento
    defaultPendencies: [
      {
        name: 'Aguardar Resultado',
        description: 'Monitorar análise do convênio (prazo ANS: 21 dias úteis)',
        key: PendencyKeys.waitAnalysis,
        responsible: 'collaborator',
        isWaiting: true,
      },
    ],
  },
  inScheduling: {
    value: 4,
    label: 'Em Agendamento',
    nextStatus: 5, // Agendada
    defaultPendencies: [
      {
        name: 'Definir Opções de Data',
        description: 'Inserir 3 opções de data para cirurgia',
        key: PendencyKeys.defineDates,
        responsible: 'collaborator',
      },
      {
        name: 'Paciente Escolher Data',
        description: 'Aguardar paciente escolher a data preferida',
        key: PendencyKeys.patientChooseDate,
        responsible: 'patient',
      },
    ],
  },
  scheduled: {
    value: 5,
    label: 'Agendada',
    nextStatus: 6, // Realizada
    defaultPendencies: [
      {
        name: 'Guia de Autorização',
        description: 'Anexar guia de autorização assinada',
        key: PendencyKeys.documents.authorizationGuide,
        responsible: 'collaborator',
      },
      {
        name: 'Confirmar Cirurgia',
        description: 'Confirmar que a cirurgia foi realizada',
        key: PendencyKeys.confirmSurgery,
        responsible: 'collaborator',
      },
    ],
  },
  performed: {
    value: 6,
    label: 'Realizada',
    nextStatus: 7, // Faturada
    defaultPendencies: [
      {
        name: 'Descrição da Cirurgia',
        description: 'Inserir descrição do procedimento realizado',
        key: PendencyKeys.surgeryDescription,
        responsible: 'collaborator',
      },
      {
        name: 'Valor Faturado',
        description: 'Preencher valor a ser faturado',
        key: PendencyKeys.invoicedValue,
        responsible: 'collaborator',
      },
      {
        name: 'Arquivo de Faturamento',
        description: 'Anexar protocolo de faturamento',
        key: PendencyKeys.documents.invoiceProtocol,
        responsible: 'collaborator',
      },
    ],
  },
  invoiced: {
    value: 7,
    label: 'Faturada',
    nextStatus: 8, // Finalizada
    defaultPendencies: [
      {
        name: 'Registrar Recebimento',
        description: 'Registrar valor e data de recebimento',
        key: PendencyKeys.registerReceipt,
        responsible: 'collaborator',
      },
    ],
  },
  finished: {
    value: 8,
    label: 'Finalizada',
    defaultPendencies: [],
  },
  canceled: {
    value: 9,
    label: 'Cancelada',
    defaultPendencies: [],
  },
};

export default statuses;
