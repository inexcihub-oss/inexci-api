# Termos de Uso da Inexci

**Versão:** 1.0 (DRAFT — pendente revisão jurídica)
**Vigência:** a partir de [DATA A DEFINIR]

> ⚠️ **AVISO INTERNO** — Draft inicial gerado pela engenharia para revisão jurídica. **Não publicar nem aplicar em produção sem revisão por advogado(a) especializado(a).**

---

## 1. Aceitação

Ao criar conta na plataforma **Inexci** ([RAZÃO SOCIAL], CNPJ [CNPJ]) você (o "Usuário") declara ter lido, compreendido e aceito integralmente estes Termos de Uso e a [Política de Privacidade](privacy-policy-1.0.md). Se não concordar com qualquer disposição, não utilize a plataforma.

---

## 2. Definições

- **Plataforma:** software-como-serviço da Inexci, acessível via web (`[app.inexci.com]`) e via canais auxiliares (WhatsApp).
- **Usuário:** profissional de saúde, colaborador autorizado por um profissional de saúde, ou administrador interno da Inexci.
- **Médico:** Usuário com `doctor_profile` cadastrado, registro ativo no respectivo conselho profissional.
- **Colaborador:** Usuário sem `doctor_profile`, com acesso delegado por um ou mais médicos.
- **Paciente:** pessoa física cujos dados são inseridos pelo Médico para fins de gestão de solicitação cirúrgica.
- **Solicitação Cirúrgica (SC):** processo coordenado pela plataforma para autorização, agendamento, realização e faturamento de procedimento cirúrgico.
- **Assistente de IA:** funcionalidade opcional que utiliza inteligência artificial fornecida por terceiro para auxiliar nas comunicações via WhatsApp.

---

## 3. Quem pode usar

A plataforma é destinada exclusivamente a:

- Médicos com registro ativo em Conselho Regional de Medicina.
- Colaboradores autorizados por médicos ativos.
- Equipe interna da Inexci.

O Usuário declara, ao se cadastrar:

a) Ser maior de 18 anos.
b) Possuir capacidade civil plena.
c) Estar com seu registro profissional regular (quando aplicável).
d) Que as informações fornecidas no cadastro são verdadeiras.

A Inexci pode, a qualquer tempo, solicitar comprovação documental do registro profissional e suspender contas que não a apresentem.

---

## 4. Conta de acesso

- O Usuário é responsável por manter a confidencialidade de suas credenciais (senha, JWT, links de acesso temporários).
- Compartilhamento de credenciais é proibido. Cada Colaborador deve ter conta própria, com acesso explícito concedido pelo Médico via `user_doctor_access`.
- Notificar imediatamente o suporte em caso de suspeita de uso indevido.
- A Inexci não se responsabiliza por danos decorrentes do uso indevido das credenciais por terceiros.

---

## 5. Uso aceitável

O Usuário compromete-se a:

a) Inserir apenas dados de pacientes para os quais tenha **consentimento livre, informado e inequívoco** para tratamento dos dados pessoais e sensíveis (saúde), nos termos da LGPD.
b) Não inserir dados falsos ou de pessoas que não sejam efetivamente seus pacientes.
c) Não utilizar a plataforma para fins ilícitos, fraudulentos, contrários à ética médica ou em prejuízo de terceiros.
d) Não tentar burlar mecanismos de segurança, fazer engenharia reversa, scraping não autorizado ou ataques de negação de serviço.
e) Não utilizar a plataforma para enviar spam, conteúdo ofensivo, discriminatório ou em violação ao Código de Ética Médica (CFM nº 2.217/2018).
f) Cumprir os limites de uso (rate limit) impostos pela plataforma.

A Inexci pode suspender ou encerrar contas que violem este uso aceitável, sem aviso prévio em casos graves.

---

## 6. Assistente de Inteligência Artificial

### 6.1 Características

A plataforma oferece, **opcionalmente**, um assistente de IA acessível via WhatsApp para auxiliar:

- Consulta ao status de solicitações cirúrgicas.
- Atualização de dados administrativos e clínicos.
- Confirmação de datas, anexação de documentos.
- Esclarecimento de dúvidas sobre o fluxo da plataforma.

### 6.2 Provedor terceirizado

O assistente é tecnicamente operado pela **Microsoft Corporation** por meio do serviço **Azure OpenAI Service**, hospedado na região **Brasil-Sul (São Paulo)**. As mensagens trocadas são processadas localmente, sem transferência internacional de dados, e sob política de **Zero Data Retention (ZDR)** — o provedor não armazena prompts/completions após o processamento e não os utiliza para treinar modelos.

### 6.3 Pseudonimização aplicada

Antes de qualquer dado ser enviado ao provedor, a Inexci substitui identificadores diretos (nome, CPF, telefone, e-mail, hospital, convênio, protocolo) por códigos opacos (`{{patient_name_1}}`, etc.). O provedor recebe apenas o conteúdo pseudonimizado.

### 6.4 Limitações

O Usuário reconhece que:

a) O assistente de IA pode cometer erros, gerar informações imprecisas ou interpretar incorretamente solicitações.
b) Decisões clínicas, administrativas ou financeiras tomadas com base nas respostas do assistente são de **exclusiva responsabilidade do Médico**.
c) Conteúdo livre digitado ou falado (descrições clínicas, sintomas) pode não ser completamente mascarado pela pseudonimização e, ainda assim, é processado pelo provedor terceirizado (sob ZDR e sem retenção, mas fora da infraestrutura direta da Inexci).
d) **O assistente não substitui o julgamento clínico**, não emite diagnósticos, não recomenda condutas terapêuticas e não deve ser utilizado para esses fins.

### 6.5 Consentimento opcional e revogável

O uso do assistente exige **consentimento explícito e separado** (art. 7º, I e art. 11, I da LGPD), coletado **uma única vez no primeiro acesso à plataforma web** em `/configuracoes/privacidade`. O Usuário pode ativar/desativar o assistente a qualquer momento na mesma página. A revogação dispara anonimização das conversas anteriores.

**WhatsApp não é canal de coleta de consentimento.** Quando o Usuário sem consentimento ativo de IA enviar mensagem ao bot, ele continua recebendo:

- **Avisos automáticos** sobre suas SCs (mudanças de status, agendamento, faturamento) — comunicações transacionais.
- **Respostas a dúvidas gerais sobre a Inexci** (suporte e perguntas operacionais sobre como usar a plataforma) usando uma **base de conhecimento estática** que não contém dados de pacientes nem de SCs específicas.

O assistente, contudo, **não conversa de forma assistida** sobre solicitações ou pacientes específicos enquanto o consentimento de IA não estiver ativo. Para isso, o Usuário é redirecionado a `/configuracoes/privacidade`.

### 6.6 Declaração quanto aos pacientes ao ativar a IA

Ao ativar a IA, o Médico/Colaborador declara expressamente, sob sua responsabilidade profissional, **ter obtido previamente consentimento livre, informado e inequívoco dos seus pacientes** para o tratamento dos dados pessoais e sensíveis deles na plataforma, incluindo o uso do assistente de IA conforme descrito no [Aviso de Uso de IA](ai-disclosure-1.0.md). A Inexci confia nessa declaração e **não exige upload de termos** assinados dos pacientes na plataforma. Cabe ao Médico/Colaborador manter sob sua guarda a evidência do consentimento e apresentá-la quando solicitado por autoridade competente.

---

## 7. Responsabilidades do Médico em relação ao paciente

O Médico/Colaborador, ao cadastrar pacientes na plataforma:

a) Declara ter obtido consentimento expresso do paciente (ou de seu responsável legal) para o tratamento de dados pessoais e sensíveis nos termos da LGPD, **inclusive — quando ativada a IA — para o uso do assistente conforme descrito na seção 6**.
b) Mantém **em sua posse e sob sua responsabilidade profissional** a evidência da coleta de consentimento (termo físico assinado, gravação de áudio com declaração explícita, registro em prontuário ou registro digital). A Inexci **não armazena nem solicita upload** dessa evidência na plataforma — é uma obrigação legal e ética do Médico/Colaborador, equiparável às demais obrigações documentais da prática clínica.
c) É o **controlador** dos dados clínicos do paciente nos termos da LGPD; a Inexci atua como **operador** quando processa esses dados sob suas instruções.
d) É responsável por informar ao paciente sobre o uso da plataforma e, quando aplicável, do assistente de IA.
e) Compromete-se a não cadastrar dados de pacientes sem consentimento e a remover dados de pacientes que revoguem o consentimento.

A Inexci pode, em caso de incidente ou auditoria de autoridade competente, solicitar ao Médico/Colaborador que apresente a evidência do consentimento de pacientes específicos. A ausência dessa evidência é responsabilidade exclusiva do Médico/Colaborador.

---

## 8. Propriedade intelectual

- O software, marca, design e conteúdo da plataforma são de propriedade exclusiva da Inexci.
- O conteúdo gerado pelo Usuário (solicitações, mensagens, documentos anexados) permanece de propriedade do Usuário/paciente; a Inexci recebe apenas licença não exclusiva para processamento conforme estes Termos e a Política de Privacidade.
- É proibido reproduzir, copiar, modificar, descompilar ou criar obras derivadas do software sem autorização expressa.

---

## 9. Disponibilidade do serviço

- A Inexci envida esforços razoáveis para manter a plataforma disponível 24/7, sem garantir, contudo, ausência total de interrupções.
- Manutenções programadas são comunicadas com antecedência razoável.
- A Inexci não é responsável por indisponibilidade decorrente de falhas em provedores de infraestrutura terceirizados, ataques externos não preveníveis ou caso fortuito/força maior.

---

## 10. Pagamento e plano (quando aplicável)

[A DEFINIR conforme modelo comercial — descrever planos, ciclos de cobrança, cancelamento, reembolso, política de inadimplência.]

---

## 11. Limitação de responsabilidade

Na máxima extensão permitida pela legislação:

a) A Inexci não responde por danos indiretos, lucros cessantes, perda de oportunidade, perda de chance ou danos de terceiros decorrentes do uso da plataforma.
b) A responsabilidade total agregada da Inexci, em qualquer ano calendário, fica limitada ao valor pago pelo Usuário nos 12 meses anteriores ao fato gerador, ou a R$ 10.000,00 (dez mil reais) — o que for maior. [Cláusula sujeita à revisão pelo CDC.]
c) A Inexci não responde por:
   - Decisões clínicas tomadas pelo Médico.
   - Erros decorrentes de informações imprecisas inseridas pelo Usuário.
   - Atos de terceiros (convênios, hospitais, fornecedores de OPME).
   - Conduta do paciente.

---

## 12. Encerramento

### 12.1 Pelo Usuário
O Usuário pode encerrar sua conta a qualquer momento em `/configuracoes/conta`. Após o encerramento, a Inexci preserva os dados pelos prazos descritos na Política de Privacidade (5 anos para dados de SC, conforme prescrição).

### 12.2 Pela Inexci
A Inexci pode suspender ou encerrar contas, com ou sem aviso conforme a gravidade, em caso de:
- Violação destes Termos.
- Inserção de dados falsos.
- Comprovação de inserção de dados de paciente sem o respectivo consentimento legal.
- Uso indevido do assistente de IA.
- Inadimplência (quando aplicável).
- Determinação judicial ou de autoridade competente.

---

## 13. Alterações destes Termos

Versionamento `MAJOR.MINOR`. Mudanças **MAJOR** exigem novo aceite no próximo acesso. Mudanças **MINOR** são comunicadas por e-mail/banner sem exigir aceite. O histórico fica em `[app.inexci.com/termos/historico]`.

---

## 14. Comunicações

Comunicações oficiais da Inexci ao Usuário ocorrem por:

- E-mail cadastrado.
- WhatsApp cadastrado (mensagens transacionais; o consentimento de IA é separado).
- Banner ou modal dentro da plataforma.

O Usuário compromete-se a manter os dados de contato atualizados.

---

## 15. Foro

Fica eleito o foro da comarca de **[CIDADE/UF da sede]** para dirimir quaisquer questões oriundas destes Termos, com renúncia a qualquer outro, por mais privilegiado que seja, exceto para o Usuário consumidor (CDC), que pode optar pelo foro de seu domicílio.

---

**Inexci — Termos de Uso versão 1.0 (DRAFT) — gerado em 2026-05-07 pela engenharia. Pendente revisão jurídica antes de publicação.**
