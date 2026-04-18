export const FAQ_SEED = [
  {
    question: 'O que é a INEXCI?',
    answer:
      'A INEXCI é uma plataforma digital para gestão de solicitações cirúrgicas. Ela automatiza o fluxo de autorização de procedimentos: médicos submetem pedidos, convênios analisam e autorizam, hospitais agendam e confirmam, e o sistema gerencia faturamento e pagamentos.',
  },
  {
    question: 'Como submeto uma solicitação cirúrgica?',
    answer:
      'Para submeter uma solicitação, acesse a plataforma web, clique em "Nova Solicitação" e preencha os dados do paciente, procedimento (com código TUSS/TISS), hospital e convênio. Após revisar, clique em "Enviar". O status mudará de Pendente para Enviada.',
  },
  {
    question: 'Quais são os status de uma solicitação cirúrgica?',
    answer:
      'Os status são: 1=Pendente, 2=Enviada, 3=Em Análise, 4=Em Agendamento, 5=Agendada, 6=Realizada, 7=Faturada, 8=Finalizada, 9=Encerrada. O fluxo segue essa ordem e pode haver contestação em múltiplas etapas.',
  },
  {
    question: 'O que é uma pendência?',
    answer:
      'Uma pendência é um item obrigatório que ainda não foi preenchido na solicitação. Pendências bloqueantes impedem o avanço do status. Você pode ver as pendências de uma solicitação pelo WhatsApp com o comando "quais são as pendências da SC-XXXX?".',
  },
  {
    question: 'Como verifico o status de uma solicitação?',
    answer:
      'Via WhatsApp, diga "qual o status da SC-XXXX?" (substitua XXXX pelo número do protocolo) ou "status da cirurgia do paciente [nome]". Você também pode acessar a plataforma web para ver todos os detalhes.',
  },
  {
    question: 'O que é OPME?',
    answer:
      'OPME (Órteses, Próteses e Materiais Especiais) são materiais cirúrgicos especiais que precisam ser separados no pedido de autorização. Se uma cirurgia requer OPME, a solicitação deve ter o campo "Possui OPME" marcado como Sim e os itens cadastrados.',
  },
  {
    question: 'Posso avançar o status de uma solicitação pelo WhatsApp?',
    answer:
      'Sim, mas apenas para os status iniciais: de Pendente para Enviada, de Enviada para Em Análise, e de Em Análise para Em Agendamento. Ações nos status mais avançados (Agendada, Realizada, Faturada) precisam ser feitas na plataforma web.',
  },
  {
    question: 'Como altero a prioridade de uma solicitação?',
    answer:
      'Via WhatsApp, diga "alterar prioridade da SC-XXXX para urgente" (opções: baixa, média, alta, urgente). O assistente pedirá confirmação antes de aplicar.',
  },
  {
    question: 'O que fazer se minha solicitação foi contestada?',
    answer:
      'Em caso de contestação pelo convênio ou hospital, você receberá uma notificação. Acesse a plataforma web para ver os motivos detalhados e registrar uma resposta/recurso. O WhatsApp informa o status mas o processo de contestação deve ser tratado na plataforma web.',
  },
  {
    question: 'Como faço para me cadastrar na INEXCI?',
    answer:
      'Para se cadastrar, acesse a plataforma web da INEXCI e clique em "Criar conta". Preencha seus dados profissionais (CRM para médicos) e aguarde a validação. Após ativação, você pode associar seu número de WhatsApp para usar o assistente.',
  },
  {
    question: 'Posso encerrar uma solicitação pelo WhatsApp?',
    answer:
      'Sim, mas essa ação requer confirmação explícita pois é irreversível. Diga "encerrar a solicitação SC-XXXX" e informe o motivo. O assistente pedirá que você confirme antes de executar.',
  },
  {
    question: 'O que é um convênio na plataforma?',
    answer:
      'Convênio (plano de saúde) é a operadora responsável por autorizar e pagar o procedimento. Na INEXCI, cada solicitação está vinculada a um convênio específico que recebe as informações para análise e autorização.',
  },
];

export const WORKFLOW_SEED = [
  {
    title: 'Fluxo de Autorização Cirúrgica — Visão Geral',
    content: `O fluxo de autorização cirúrgica na INEXCI segue estas etapas:

1. PENDENTE: Solicitação criada pelo médico. Deve ser preenchida com todos os dados obrigatórios.
2. ENVIADA: Após preencher as pendências, o médico envia ao convênio.
3. EM ANÁLISE: O convênio recebeu e está analisando o pedido.
4. EM AGENDAMENTO: Convênio autorizou; hospital está agendando a cirurgia.
5. AGENDADA: Data e hora da cirurgia confirmadas pelo hospital.
6. REALIZADA: Procedimento executado com sucesso.
7. FATURADA: Nota fiscal/TISS enviada para cobrança.
8. FINALIZADA: Pagamento recebido e processo concluído.
9. ENCERRADA: Solicitação cancelada ou não executada.

A qualquer momento pode ocorrer uma CONTESTAÇÃO, que suspende o fluxo até resolução.`,
  },
  {
    title: 'Pendências Bloqueantes por Status',
    content: `Cada etapa do fluxo exige pré-requisitos:

PARA ENVIAR (status 1→2):
- Paciente vinculado (nome, CPF, data nascimento)
- Convênio selecionado
- Hospital selecionado
- Pelo menos 1 procedimento com código TUSS cadastrado
- CID principal informado

PARA INICIAR ANÁLISE (status 2→3):
- Laudo médico preenchido (indicação clínica)
- Todos os documentos obrigatórios do convênio anexados

PARA ENTRAR EM AGENDAMENTO (status 3→4):
- Autorização registrada com número
- Data de validade da autorização informada`,
  },
  {
    title: 'Documentos Necessários por Convênio',
    content: `Cada convênio pode exigir documentos específicos. Os documentos comuns são:
- Laudo médico detalhado
- Pedido de autorização (TISS)
- Exames complementares (laudos de imagem, laboratoriais)
- Carta médica justificando urgência (se aplicável)
- Guia OPME (se houver órteses/próteses)

Os documentos devem ser anexados na aba "Documentos" da solicitação na plataforma web. O sistema indica quais documentos estão faltando na tela de pendências.`,
  },
  {
    title: 'Contestação — Como Funciona',
    content: `Uma contestação ocorre quando convênio ou hospital rejeita parcialmente ou pede revisão de uma solicitação.

O processo de contestação:
1. Você é notificado por email e WhatsApp sobre a contestação
2. Na plataforma web, acesse a solicitação e veja o motivo detalhado
3. Prepare a documentação complementar ou ajuste os dados solicitados
4. Registre sua resposta/recurso no campo de contestação
5. O convênio volta a analisar com as novas informações

Importante: enquanto há uma contestação ativa, o fluxo principal fica suspenso.`,
  },
];

export const GLOSSARY_SEED = [
  {
    title: 'Glossário — Termos da Plataforma',
    content: `TUSS: Terminologia Unificada da Saúde Suplementar — código padronizado para procedimentos médicos no sistema de saúde suplementar brasileiro.

TISS: Troca de Informações em Saúde Suplementar — padrão nacional de comunicação entre prestadores e operadoras de planos de saúde.

CID: Classificação Internacional de Doenças — código diagnóstico internacional (ex: CID K80.2 = colecistite).

OPME: Órteses, Próteses e Materiais Especiais — materiais cirúrgicos especiais (próteses de quadril, parafusos ósseos, stents, etc.).

Protocolo: Número único da solicitação cirúrgica na INEXCI (formato SC-XXXX, ex: SC-0042).

Laudo: Documento médico descrevendo a indicação clínica do procedimento, histórico do paciente e justificativa cirúrgica.

Guia: Documento oficial de solicitação enviado ao convênio contendo todos os códigos e dados para autorização.

Convênio: Operadora de plano de saúde responsável por autorizar e pagar o procedimento.

Colaborador: Usuário do sistema que trabalha em equipe com um médico (assistente, secretária). Acessa as solicitações do médico associado.`,
  },
];
