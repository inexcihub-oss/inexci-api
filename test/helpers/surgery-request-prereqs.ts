import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

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
