# Política de Privacidade da Inexci

## 1. Quem somos

A **Inexci** ([RAZÃO SOCIAL COMPLETA], CNPJ [CNPJ], com sede em [ENDEREÇO]) é a controladora dos dados pessoais tratados na plataforma de gestão de solicitações cirúrgicas disponível em [DOMÍNIO PRINCIPAL]. Esta Política descreve como coletamos, usamos, compartilhamos e protegemos esses dados.

Para qualquer assunto relacionado a esta Política, fale com o nosso **Encarregado pelo Tratamento de Dados (DPO)**:

- **Nome / razão social:** [NOME DO DPO]
- **E-mail:** [dpo@inexci.com — confirmar canal definitivo]
- **Formulário público:** [URL do formulário de contato — A DEFINIR]

---

## 2. A quem esta Política se aplica

Tratamos dados de três grupos distintos:

| Grupo | Como entram em contato com a plataforma |
|---|---|
| **Médicos e colaboradores** | Cadastram-se na plataforma, gerenciam solicitações cirúrgicas e usam canais (web, WhatsApp). |
| **Pacientes** | Têm seus dados inseridos pelo médico responsável; não interagem diretamente com a plataforma na maioria dos casos. |
| **Visitantes do site** | Navegam por páginas públicas, sem cadastro. |

---

## 3. Quais dados coletamos

### 3.1 De médicos e colaboradores

- **Identificação:** nome completo, CPF, e-mail, telefone, CRM (quando aplicável), número da inscrição estadual/profissional.
- **Acesso:** senha (armazenada com hash bcrypt), endereço IP, registros de login, dispositivos.
- **Contato profissional:** endereço da clínica, dados bancários para repasse (se aplicável).
- **Conteúdo gerado:** solicitações cirúrgicas criadas, mensagens trocadas no WhatsApp com o assistente, áudios enviados, documentos anexados.

### 3.2 De pacientes

- **Identificação:** nome completo, CPF, RG, telefone, e-mail (quando informado), data de nascimento, endereço, gênero.
- **Dados de saúde (sensíveis, art. 5º, II da LGPD):** diagnóstico, CID, descrição cirúrgica, laudo médico, histórico clínico, OPME (Órteses, Próteses e Materiais Especiais) prescritos, código TUSS dos procedimentos, convênio/plano de saúde, hospital de realização, data e horário da cirurgia, evolução pós-operatória, valores praticados.
- **Documentos:** laudos em PDF/imagem, exames, autorizações do convênio.

### 3.3 De visitantes

- **Tecnológicos:** endereço IP, tipo de navegador, sistema operacional, páginas visitadas, cookies essenciais.

---

## 4. Para que usamos os dados (finalidades)

| Finalidade | Categoria de dado | Base legal |
|---|---|---|
| Cadastro e autenticação na plataforma | Identificação + acesso do médico/colaborador | Execução de contrato (art. 7º, V) |
| Gestão da solicitação cirúrgica (criação, autorização, agendamento, realização, faturamento) | Dados do paciente, dados clínicos, documentos | Tutela da saúde (art. 11, II, "f") + consentimento intermediado pelo médico |
| Comunicação automatizada com o médico via WhatsApp (status, lembretes) | Telefone do médico, conteúdo de mensagem | Execução de contrato + consentimento |
| Comunicação automatizada com o paciente via WhatsApp/e-mail | Telefone, e-mail, conteúdo | Consentimento intermediado pelo médico |
| **Assistente de IA via WhatsApp** | Conteúdo das mensagens, dados pseudonimizados das solicitações | **Consentimento explícito e separado** (art. 7º, I e art. 11, I) |
| Geração de PDFs (autorização, laudo, contestação) | Dados clínicos e administrativos da SC | Execução de contrato |
| Faturamento ao convênio | Identificação do paciente, dados do plano, valores | Obrigação legal + execução de contrato |
| Suporte ao usuário | Identificação + histórico de uso | Execução de contrato + legítimo interesse |
| Segurança da plataforma (anti-fraude, anti-abuso) | Logs de acesso, IP | Legítimo interesse (art. 7º, IX) |
| Cumprimento de obrigações legais (fiscal, trabalhista) | Identificação + dados financeiros | Cumprimento de obrigação legal (art. 7º, II) |

---

## 5. Com quem compartilhamos os dados (operadores)

A Inexci utiliza fornecedores terceirizados para operar a plataforma. Cada um trata dados estritamente limitados à finalidade contratada e está sujeito a contrato de operador conforme art. 39 da LGPD.

| Operador | Finalidade | Localização | Transferência internacional? | Garantia |
|---|---|---|---|---|
| **Microsoft Corporation** (Azure OpenAI Service) | Assistente de IA (geração de respostas no WhatsApp) | **Brasil — região Brasil-Sul (São Paulo)** | **Não** | DPA padrão da Microsoft (Online Services DPA) + Zero Data Retention contratual |
| **Twilio Inc.** | Envio e recebimento de mensagens WhatsApp | Estados Unidos / Irlanda | **Sim** | DPA assinado [PENDENTE confirmar] |
| **Sendinblue / Brevo SAS** | Envio de e-mail transacional | França (UE) | **Sim** (transferência adequada — UE possui nível adequado de proteção) | DPA assinado [PENDENTE confirmar] |
| **Supabase Inc.** | Armazenamento de arquivos (laudos, exames, documentos) | [região do bucket — A DEFINIR] | [Sim/Não conforme região] | DPA + criptografia at-rest |
| **Amazon Web Services (AWS)** | Armazenamento adicional via SDK S3 (quando aplicável) | [região — A DEFINIR] | [Sim/Não] | DPA + criptografia |
| **[Provedor de hospedagem da API]** | Hospedagem do backend e do frontend | [Brasil / EUA — A DEFINIR] | [conforme] | DPA |
| **PostgreSQL gerenciado** ([provedor]) | Banco de dados relacional | [região — A DEFINIR] | [conforme] | TLS + criptografia at-rest |

A lista acima pode ser atualizada conforme novos operadores forem contratados; a versão vigente está sempre em [URL DEDICADA — sugestão `app.inexci.com/privacidade/operadores`].

---

## 5.1 Divisão de papéis e cadeia de consentimento

A Inexci atua, **em relação aos seus dados como Médico/Colaborador** (cadastro, autenticação, comunicações com você), como **Controladora**.

Em relação aos **dados dos pacientes** que você cadastra, a Inexci atua como **Operadora** sob suas instruções; **você é o Controlador** desses dados.

O **consentimento dos pacientes** é, portanto, **obtido por você**, fora da plataforma, de acordo com a sua prática clínica habitual. A Inexci **não exige upload nem armazena evidência de termo assinado** dos pacientes; apenas confia na sua declaração — registrada eletronicamente quando você aceita o [Aviso de Uso de IA](ai-disclosure-1.0.md) — de que obteve o consentimento e mantém a evidência sob sua guarda.

Caso ocorra incidente, auditoria ou solicitação de autoridade competente envolvendo dados de paciente específico, **você se compromete a apresentar a evidência do consentimento** que mantém. A ausência dessa evidência é responsabilidade exclusiva sua.

---

## 6. Transferência internacional de dados

Alguns dos nossos operadores estão localizados fora do Brasil. Nesses casos, a transferência internacional ocorre com base em **cláusulas-padrão contratuais aprovadas pela Autoridade Nacional de Proteção de Dados (Resolução CD/ANPD nº 19/2024)** e em DPAs específicos com cada fornecedor.

Para o **assistente de IA**, o conteúdo das suas mensagens é processado pela **Microsoft Azure OpenAI Service na região Brasil-Sul (São Paulo)** — **sem transferência internacional de dados**. A Microsoft opera o serviço sob política de **Zero Data Retention (ZDR)**: prompts e respostas não são armazenados pelo provedor após o processamento, não são utilizados para treinar modelos e não ficam disponíveis para revisão humana.

Como camada adicional, antes do envio ao provedor aplicamos **pseudonimização** que substitui nomes, CPFs, telefones, e-mails, hospitais e convênios por códigos opacos do tipo `{{patient_name_1}}`. O provedor recebe apenas o texto pseudonimizado; a substituição reversa só acontece dentro da nossa infraestrutura, antes da entrega ao seu WhatsApp.

> ⚠️ **Limitação técnica reconhecida:** o conteúdo livre digitado/falado pelo usuário (descrição clínica, sintomas, evolução) não é completamente mascarado quando contém termos genéricos. Mesmo sob ZDR e residência de dados no Brasil, esse conteúdo é processado por um operador terceirizado — não recomendamos digitar no assistente informações que você não autorizaria a processamento por terceiros.

---

## 7. Por quanto tempo guardamos os dados (retenção)

| Categoria | Prazo | Justificativa |
|---|---|---|
| Cadastro do médico/colaborador (conta ativa) | Durante a vigência do contrato | Necessidade |
| Conta do médico após cancelamento | 5 anos | Prazo prescricional (CC/CDC) |
| Solicitações cirúrgicas finalizadas/encerradas | 5 anos após o encerramento | Prazo prescricional |
| Mensagens WhatsApp (`whatsapp_conversation_messages`) | **15 dias** | Mínimo necessário para continuidade do diálogo |
| Logs de uso da IA (`ai_token_usage_logs`) | 365 dias | Auditoria e custo |
| Logs operacionais (`notification_send_logs`) | 90 dias | Suporte e investigação |
| Logs de redação de PII (`ai_pii_redaction_logs`) | 180 dias | Compliance |
| Backups criptografados | 30 dias rolling | Recuperação |

Após esses prazos, os dados são **excluídos ou anonimizados**, conforme procedimento documentado.

---

## 8. Segurança das informações

Adotamos as medidas previstas no art. 46 da LGPD, incluindo:

- TLS 1.2+ obrigatório em todas as conexões (web, API, webhooks).
- Senhas armazenadas com hash bcrypt (custo ≥ 10).
- JWT com expiração de 7 dias para autenticação.
- Validação HMAC dos webhooks da Twilio.
- Pseudonimização de PII antes do envio à IA externa (PII Vault).
- Filtro defensivo que aborta chamadas ao provedor de IA se detectar PII residual.
- Auditoria registrada na tabela `ai_pii_redaction_log`.
- Acesso ao banco de dados restrito por VPC e credenciais rotacionadas.
- Controle de acesso baseado em papel (admin / colaborador) e isolamento por `account_id` (em implementação — ver Fase 3 do plano técnico).
- Logs de acesso e modificação preservados.
- Backups criptografados com chave gerenciada.
- Pen test e revisão de dependências anuais.

---

## 9. Seus direitos como titular dos dados

Conforme o art. 18 da LGPD, você tem direito a:

1. **Confirmar** a existência de tratamento.
2. **Acessar** os dados.
3. **Corrigir** dados incompletos, inexatos ou desatualizados.
4. **Anonimizar, bloquear ou eliminar** dados desnecessários ou tratados em desconformidade.
5. **Portar** os dados a outro fornecedor.
6. **Eliminar** os dados tratados com base no consentimento (exceto quando houver outra base legal aplicável, como obrigação legal).
7. **Obter informação** sobre as entidades com as quais compartilhamos seus dados.
8. **Obter informação** sobre a possibilidade de não fornecer consentimento e suas consequências.
9. **Revogar** o consentimento.

Para exercer qualquer desses direitos, acesse `[app.inexci.com/configuracoes/privacidade]` (titulares cadastrados) ou envie e-mail para `[dpo@inexci.com]` com cópia do documento de identificação.

**Prazo de resposta:** até **15 dias úteis**, prorrogáveis por mais 15 mediante justificativa.

---

## 10. Cookies e tecnologias similares

Utilizamos cookies essenciais para autenticação e funcionamento da plataforma. Não utilizamos cookies de marketing ou rastreamento de terceiros sem o seu consentimento explícito. [Ajustar caso introduzam analytics — Google Analytics, Mixpanel etc. — exigem consentimento granular.]

---

## 11. Crianças e adolescentes

A plataforma é destinada a profissionais de saúde maiores de 18 anos. Quando dados de pacientes menores de idade forem inseridos pelo médico, o consentimento deve ser obtido dos pais ou responsáveis legais, conforme o art. 14 da LGPD.

---

## 12. Alterações desta Política

Esta Política pode ser atualizada periodicamente. Versionamos no formato `MAJOR.MINOR`:

- **MAJOR** (ex.: 1.0 → 2.0): mudança material; usuários precisarão **reaceitar** a Política no próximo acesso.
- **MINOR** (ex.: 1.0 → 1.1): correções redacionais ou de operadores; comunicada por e-mail/banner.

O histórico de versões fica disponível em `[app.inexci.com/privacidade/historico]`.

---

## 13. Foro e legislação aplicável

Esta Política é regida pelas leis brasileiras, em especial pela **Lei 13.709/2018 (LGPD)**, **Marco Civil da Internet (Lei 12.965/2014)** e **Resoluções da ANPD**. Fica eleito o foro da comarca de **[CIDADE/UF da sede]** para dirimir quaisquer questões dela decorrentes.

---

**Inexci — versão 1.0 (DRAFT) — gerado em 2026-05-07 pela engenharia. Pendente revisão jurídica antes de publicação.**
