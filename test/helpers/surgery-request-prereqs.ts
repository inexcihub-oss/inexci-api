import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';

/**
 * Pré-requisitos de `PENDING -> SENT`.
 *
 * `PendencyValidatorService.assertCanAdvance()` (fonte de verdade em
 * `pendencies.config.ts`) exige 5 pendências bloqueantes para sair de PENDING:
 * `patient_data`, `hospital_data`, `tuss_procedures`, `opme_items` e
 * `medical_report`. As duas primeiras vêm do próprio payload de criação da SC;
 * as outras três precisam ser resolvidas por rota, e é o que estes helpers
 * fazem. Sem isso, `POST /:id/send` responde 400 com a lista de pendências e
 * todo o restante do fluxo fica preso em PENDING.
 */

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * `medical_report` também cobra "Assinatura do médico configurada" — grava
 * `doctor_profiles.signature_url` via a rota de perfil médico (o `:id` aqui é
 * o **userId** do médico, não o id do profile).
 */
export async function configurarAssinaturaDoMedico(
  app: INestApplication,
  token: string,
  doctorUserId: string,
): Promise<void> {
  await request(app.getHttpServer())
    .patch(`/users/doctor-profile/${doctorUserId}`)
    .set(authHeader(token))
    .send({ signatureImageUrl: 'https://cdn.inexci.test/assinatura-e2e.png' })
    .expect(200);
}

/**
 * `opme_items` fica pendente enquanto `hasOpme` for indefinido — não basta não
 * ter itens, é preciso declarar que a SC não usa OPME.
 */
export async function declararSemOpme(
  app: INestApplication,
  token: string,
  surgeryRequestId: string,
): Promise<void> {
  await request(app.getHttpServer())
    .patch(`/surgery-requests/${surgeryRequestId}/has-opme`)
    .set(authHeader(token))
    .send({ hasOpme: false })
    .expect(200);
}

/** `medical_report` exige ao menos uma seção de laudo preenchida. */
export async function criarSecaoDeLaudo(
  app: INestApplication,
  token: string,
  surgeryRequestId: string,
): Promise<void> {
  await request(app.getHttpServer())
    .post(`/surgery-requests/${surgeryRequestId}/sections`)
    .set(authHeader(token))
    .send({
      title: 'Indicação Cirúrgica',
      description: '<p>Indicação clínica registrada pelo teste e2e.</p>',
    })
    .expect(201);
}

/** `tuss_procedures` exige ao menos um procedimento TUSS na SC. */
export async function adicionarProcedimentoTuss(
  app: INestApplication,
  token: string,
  surgeryRequestId: string,
): Promise<void> {
  await request(app.getHttpServer())
    .post('/surgery-requests/procedures')
    .set(authHeader(token))
    .send({
      surgeryRequestId,
      procedures: [
        {
          tussCode: '30101012',
          name: 'Colecistectomia Videolaparoscópica',
          quantity: 1,
        },
      ],
    })
    .expect(201);
}

/**
 * Resolve de uma vez as três pendências que dependem de rota, deixando a SC
 * pronta para `POST /:id/send`.
 */
export async function prepararScParaEnvio(
  app: INestApplication,
  token: string,
  params: { surgeryRequestId: string; doctorUserId: string },
): Promise<void> {
  await configurarAssinaturaDoMedico(app, token, params.doctorUserId);
  await declararSemOpme(app, token, params.surgeryRequestId);
  await criarSecaoDeLaudo(app, token, params.surgeryRequestId);
  await adicionarProcedimentoTuss(app, token, params.surgeryRequestId);
}
