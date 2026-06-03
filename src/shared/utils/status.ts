import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';

const STATUS_LABELS: Record<SurgeryRequestStatus, string> = {
  [SurgeryRequestStatus.PENDING]: 'Pendente',
  [SurgeryRequestStatus.SENT]: 'Enviada',
  [SurgeryRequestStatus.IN_ANALYSIS]: 'Em Análise',
  [SurgeryRequestStatus.IN_SCHEDULING]: 'Em Agendamento',
  [SurgeryRequestStatus.SCHEDULED]: 'Agendada',
  [SurgeryRequestStatus.PERFORMED]: 'Realizada',
  [SurgeryRequestStatus.INVOICED]: 'Faturada',
  [SurgeryRequestStatus.FINALIZED]: 'Finalizada',
  [SurgeryRequestStatus.CLOSED]: 'Encerrada',
};

export function getStatusLabel(status: number): string {
  return STATUS_LABELS[status as SurgeryRequestStatus] ?? String(status);
}

/** Descrição amigável do status para notificar o paciente via WhatsApp ({{3}} do template status_message_patient). */
export function getStatusDescriptionForPatient(
  status: SurgeryRequestStatus,
  details?: {
    surgeryDate?: Date | string | null;
    hospitalName?: string | null;
  },
): string {
  const surgeryDateValue = details?.surgeryDate;
  const parsedDate =
    surgeryDateValue instanceof Date
      ? surgeryDateValue
      : surgeryDateValue
        ? new Date(surgeryDateValue)
        : null;
  const hasValidSurgeryDate =
    parsedDate !== null && !Number.isNaN(parsedDate.getTime());
  const hospitalName = details?.hospitalName?.trim();

  switch (status) {
    case SurgeryRequestStatus.PENDING:
      return 'Sua solicitação cirúrgica foi criada e está aguardando envio.';
    case SurgeryRequestStatus.SENT:
      return 'Sua solicitação cirúrgica foi enviada ao hospital. Agora acompanhamos o processo para obter o protocolo junto à operadora.';
    case SurgeryRequestStatus.IN_ANALYSIS:
      return 'Sua solicitação está sendo analisada pelo convênio. Aguardamos a resposta em breve.';
    case SurgeryRequestStatus.IN_SCHEDULING:
      return 'Sua cirurgia foi autorizada e está em processo de agendamento com o hospital.';
    case SurgeryRequestStatus.SCHEDULED:
      if (hasValidSurgeryDate) {
        const datePart = parsedDate.toLocaleDateString('pt-BR');
        const timePart = parsedDate.toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });

        if (hospitalName) {
          return `Sua cirurgia está confirmada para a data ${datePart} no ${hospitalName}, horário ${timePart}.`;
        }

        return `Sua cirurgia está confirmada para a data ${datePart}, horário ${timePart}.`;
      }

      if (hospitalName) {
        return `Sua cirurgia foi agendada no ${hospitalName}! Em breve você receberá as informações sobre data e hora.`;
      }

      return 'Sua cirurgia foi agendada! Em breve você receberá as informações sobre data, hora e local.';
    case SurgeryRequestStatus.PERFORMED:
      return 'Sua cirurgia foi realizada com sucesso. Estamos processando as etapas finais.';
    case SurgeryRequestStatus.INVOICED:
      return 'O faturamento da sua cirurgia está sendo processado.';
    case SurgeryRequestStatus.FINALIZED:
      return 'Sua solicitação cirúrgica foi finalizada com sucesso.';
    case SurgeryRequestStatus.CLOSED:
      return 'Sua solicitação cirúrgica foi encerrada.';
    default:
      return 'Houve uma atualização na sua solicitação cirúrgica.';
  }
}

/** Mensagem de ação pendente por status para notificar gestor via WhatsApp ({{5}} do template status_message). */
export function getStalePendencyMessage(status: SurgeryRequestStatus): string {
  switch (status) {
    case SurgeryRequestStatus.PENDING:
      return 'Complete as informações gerais para avançar a solicitação.';
    case SurgeryRequestStatus.SENT:
      return 'Verifique se há pendências no convênio e acompanhe o recebimento.';
    case SurgeryRequestStatus.IN_ANALYSIS:
      return 'Entre em contato com o convênio para dar andamento à análise.';
    case SurgeryRequestStatus.IN_SCHEDULING:
      return 'Entre em contato com o hospital para confirmar o agendamento.';
    case SurgeryRequestStatus.SCHEDULED:
      return 'Confirme a realização do procedimento para avançar ao próximo status.';
    case SurgeryRequestStatus.PERFORMED:
      return 'Envie a documentação de faturamento para avançar.';
    case SurgeryRequestStatus.INVOICED:
      return 'Aguarde a confirmação do pagamento para finalizar.';
    default:
      return 'Acesse a plataforma para verificar o que precisa ser feito.';
  }
}
