/**
 * TESTE E2E — MÓDULO DE ATENDIMENTO (AGENDA + PRONTUÁRIO)
 *
 * Fecha a lacuna AU-08 do `PLANO-TESTES-ATENDIMENTO-AGENDA.md`: até aqui o
 * módulo tinha só teste unitário, e nenhuma suíte exercitava a pilha inteira
 * (guards de permissão, pipes, filtro de exceção, banco).
 *
 * Cobre o caminho principal — agendar → conflito 409 → abrir ficha →
 * finalizar → SC criada — e os defeitos de regressão que só aparecem no HTTP:
 * D-01 (ST-08), D-02 (FN-06), D-05 (MT-04), D-06 (EX-04), D-12 (VL-03) e
 * D-17 (ST-09).
 *
 * O setup é feito por rotas HTTP; SQL direto só onde não há rota (marcar
 * `reminder_sent_at`, inspecionar o que a API não devolve).
 */

import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
  prepararUsuarioParaLogin,
} from '../helpers/test-setup';

const DOCTOR = {
  name: 'Dr. Atendimento E2E',
  email: `dr.atendimento.${Date.now()}@inexci.test`,
  phone: '11966660001',
  password: 'Senha@12345',
  isDoctor: true,
  crm: 'CRM777001',
  crmState: 'SP',
  specialty: 'Ortopedia',
};

/** Segundo tenant — para provar que a agenda não vaza entre contas. */
const OUTRO_MEDICO = {
  name: 'Dra. Outra Clinica E2E',
  email: `dra.outra.${Date.now()}@inexci.test`,
  phone: '11966660002',
  password: 'Senha@12345',
  isDoctor: true,
  crm: 'CRM777002',
  crmState: 'SP',
  specialty: 'Ortopedia',
};

/** Horário base das consultas — futuro, para não colidir com o cron de lembrete. */
const BASE = '2027-03-15T13:00:00.000Z';

function maisMinutos(iso: string, minutos: number): string {
  return new Date(new Date(iso).getTime() + minutos * 60_000).toISOString();
}

describe('Atendimento — Agenda + Prontuário (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let token: string;
  let doctorId: string;
  let patientId: string;

  let outroToken: string;
  let outroDoctorId: string;

  function auth() {
    return { Authorization: `Bearer ${token}` };
  }

  async function registrarMedico(dados: typeof DOCTOR) {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send(dados)
      .expect(201);
    await prepararUsuarioParaLogin(app, dados.email);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: dados.email, password: dados.password })
      .expect(201);
    return {
      userId: res.body.user.id as string,
      token: login.body.access_token as string,
    };
  }

  /** Agenda uma consulta e devolve o corpo criado. */
  async function agendar(
    scheduledAt: string,
    overrides: Record<string, unknown> = {},
  ) {
    const res = await request(app.getHttpServer())
      .post('/appointments')
      .set(auth())
      .send({ patientId, doctorId, scheduledAt, ...overrides });
    return res;
  }

  async function excluirConsulta(id: string) {
    await request(app.getHttpServer())
      .delete(`/appointments/${id}`)
      .set(auth());
  }

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    await cleanDatabase(app);

    const medico = await registrarMedico(DOCTOR);
    doctorId = medico.userId;
    token = medico.token;

    const outro = await registrarMedico(OUTRO_MEDICO);
    outroDoctorId = outro.userId;
    outroToken = outro.token;

    const paciente = await request(app.getHttpServer())
      .post('/patients')
      .set(auth())
      .send({
        name: 'Paciente Atendimento E2E',
        phone: '11955550000',
        email: 'paciente.atendimento@e2e.test',
        cpf: '39053344705',
        gender: 'M',
        birthDate: '1980-04-10',
      })
      .expect(201);
    patientId = paciente.body.id;
    expect(patientId).toBeDefined();
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(app);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Bloco 2/3 — Criar consulta e conflito de horário
  // ──────────────────────────────────────────────────────────────────────────

  describe('Agenda — criação e conflito', () => {
    let criadaId: string;

    afterAll(async () => {
      if (criadaId) await excluirConsulta(criadaId);
    });

    it('cria a consulta em "scheduled" com duração padrão de 30 min', async () => {
      const res = await agendar(BASE, { notes: '  primeira consulta  ' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('scheduled');
      expect(res.body.durationMinutes).toBe(30);
      expect(res.body.notes).toBe('primeira consulta');
      expect(res.body.doctorId).toBe(doctorId);
      criadaId = res.body.id;
    });

    it('recusa com 409 outra consulta do mesmo médico no mesmo horário', async () => {
      const res = await agendar(BASE);
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('Já existe uma consulta');
    });

    it('recusa 409 quando o novo horário invade o fim da consulta existente', async () => {
      const res = await agendar(maisMinutos(BASE, 15));
      expect(res.status).toBe(409);
    });

    it('aceita a consulta que começa exatamente quando a anterior termina', async () => {
      const res = await agendar(maisMinutos(BASE, 30));
      expect(res.status).toBe(201);
      await excluirConsulta(res.body.id);
    });

    it('recusa paciente de outro tenant com 404', async () => {
      const res = await request(app.getHttpServer())
        .post('/appointments')
        .set({ Authorization: `Bearer ${outroToken}` })
        .send({
          patientId,
          doctorId: outroDoctorId,
          scheduledAt: maisMinutos(BASE, 600),
        });
      expect(res.status).toBe(404);
    });

    it('recusa médico não acessível com 403', async () => {
      const res = await agendar(maisMinutos(BASE, 660), {
        doctorId: outroDoctorId,
      });
      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Bloco 1/17 — Leitura da agenda e recorte por médico (D-05 / MT-04)
  // ──────────────────────────────────────────────────────────────────────────

  describe('Agenda — leitura e recorte', () => {
    let id: string;

    beforeAll(async () => {
      const res = await agendar(maisMinutos(BASE, 1440));
      expect(res.status).toBe(201);
      id = res.body.id;
    });

    afterAll(async () => {
      await excluirConsulta(id);
    });

    it('devolve a consulta dentro da janela pedida, com total real', async () => {
      const res = await request(app.getHttpServer())
        .get('/appointments')
        .query({
          from: maisMinutos(BASE, 1380),
          to: maisMinutos(BASE, 1500),
        })
        .set(auth())
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.records).toHaveLength(1);
      expect(res.body.records[0].id).toBe(id);
      // O join do paciente vem junto — a agenda mostra o nome sem N+1.
      expect(res.body.records[0].patient?.name).toBe(
        'Paciente Atendimento E2E',
      );
      // ...mas só id e nome. A agenda é liberada por `Permission.AGENDA`, que
      // não dá acesso a prontuário: com `leftJoinAndSelect` a entidade inteira
      // saía, e `Patient` não tem `@Exclude` em campo nenhum — CPF, endereço,
      // nascimento e `medicalNotes` de todo paciente da janela iam para quem
      // só marca consulta.
      expect(Object.keys(res.body.records[0].patient).sort()).toEqual([
        'id',
        'name',
      ]);
    });

    it('D-05: doctorId inacessível devolve lista vazia, não a agenda do médico acessível', async () => {
      const res = await request(app.getHttpServer())
        .get('/appointments')
        .query({ doctorId: outroDoctorId })
        .set(auth())
        .expect(200);

      expect(res.body).toEqual({ total: 0, records: [] });
    });

    it('não devolve a consulta para o outro tenant', async () => {
      const res = await request(app.getHttpServer())
        .get('/appointments')
        .set({ Authorization: `Bearer ${outroToken}` })
        .expect(200);

      expect(res.body.records).toHaveLength(0);
    });

    it('D-12: id malformado devolve 400 de validação, não erro de banco', async () => {
      const res = await request(app.getHttpServer())
        .get('/appointments/naoehuuid')
        .set(auth());

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain('banco de dados');
    });

    it('exige autenticação', async () => {
      await request(app.getHttpServer()).get('/appointments').expect(401);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Bloco 4/5 — Reagendar e status (D-01 / D-03 / D-17)
  // ──────────────────────────────────────────────────────────────────────────

  describe('Agenda — reagendamento e status', () => {
    let id: string;

    beforeEach(async () => {
      const res = await agendar(maisMinutos(BASE, 2880));
      expect(res.status).toBe(201);
      id = res.body.id;
    });

    afterEach(async () => {
      await dataSource.query(`DELETE FROM appointments WHERE owner_id = $1`, [
        doctorId,
      ]);
    });

    it('D-03: reagendar zera reminder_sent_at', async () => {
      await dataSource.query(
        `UPDATE appointments SET reminder_sent_at = NOW() WHERE id = $1`,
        [id],
      );

      await request(app.getHttpServer())
        .patch(`/appointments/${id}`)
        .set(auth())
        .send({ scheduledAt: maisMinutos(BASE, 2940) })
        .expect(200);

      const [row] = await dataSource.query(
        `SELECT reminder_sent_at FROM appointments WHERE id = $1`,
        [id],
      );
      expect(row.reminder_sent_at).toBeNull();
    });

    it('mudar só a observação preserva reminder_sent_at', async () => {
      await dataSource.query(
        `UPDATE appointments SET reminder_sent_at = NOW() WHERE id = $1`,
        [id],
      );

      await request(app.getHttpServer())
        .patch(`/appointments/${id}`)
        .set(auth())
        .send({ notes: 'paciente confirmou por telefone' })
        .expect(200);

      const [row] = await dataSource.query(
        `SELECT reminder_sent_at FROM appointments WHERE id = $1`,
        [id],
      );
      expect(row.reminder_sent_at).not.toBeNull();
    });

    it('D-01: reabrir consulta cancelada sobre horário reocupado devolve 409', async () => {
      const horario = maisMinutos(BASE, 2880);

      await request(app.getHttpServer())
        .patch(`/appointments/${id}/status`)
        .set(auth())
        .send({ status: 'cancelled', cancellationReason: 'paciente desmarcou' })
        .expect(200);

      // O slot é reocupado enquanto a primeira está fora da agenda.
      const nova = await agendar(horario);
      expect(nova.status).toBe(201);

      const reabrir = await request(app.getHttpServer())
        .patch(`/appointments/${id}/status`)
        .set(auth())
        .send({ status: 'scheduled' });

      expect(reabrir.status).toBe(409);

      const [{ count }] = await dataSource.query(
        `SELECT COUNT(*)::int AS count
           FROM appointments
          WHERE doctor_id = $1
            AND scheduled_at = $2
            AND status IN ('scheduled', 'confirmed')
            AND deleted_at IS NULL`,
        [doctorId, horario],
      );
      expect(count).toBe(1);
    });

    it('reabrir consulta cancelada com o horário livre volta para a agenda', async () => {
      await request(app.getHttpServer())
        .patch(`/appointments/${id}/status`)
        .set(auth())
        .send({ status: 'cancelled', cancellationReason: 'chuva' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/appointments/${id}/status`)
        .set(auth())
        .send({ status: 'scheduled' })
        .expect(200);

      expect(res.body.status).toBe('scheduled');
      // Motivo de cancelamento não sobrevive à reativação.
      expect(res.body.cancellationReason).toBeNull();
    });

    it('D-17: motivo de cancelamento acima de 500 caracteres é recusado', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/appointments/${id}/status`)
        .set(auth())
        .send({ status: 'cancelled', cancellationReason: 'x'.repeat(501) });

      expect(res.status).toBe(400);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Blocos 9/10/11 — Ficha, finalização e indicação cirúrgica
  // ──────────────────────────────────────────────────────────────────────────

  describe('Prontuário — ficha, finalização e SC', () => {
    let appointmentId: string;
    let recordId: string;

    beforeAll(async () => {
      const res = await agendar(maisMinutos(BASE, 4320));
      expect(res.status).toBe(201);
      appointmentId = res.body.id;
    });

    it('cria a ficha vinculada à consulta', async () => {
      const res = await request(app.getHttpServer())
        .post('/clinical-records')
        .set(auth())
        .send({
          patientId,
          appointmentId,
          anamnesis: '<p>Dor no joelho direito há 3 meses.</p>',
          cidCodes: [{ code: 'M17', description: 'Gonartrose' }],
        });

      expect(res.status).toBe(201);
      expect(res.body.appointmentId).toBe(appointmentId);
      expect(res.body.doctorId).toBe(doctorId);
      expect(res.body.finalizedAt).toBeNull();
      recordId = res.body.id;
    });

    it('recusa uma segunda ficha para a mesma consulta com 409', async () => {
      const res = await request(app.getHttpServer())
        .post('/clinical-records')
        .set(auth())
        .send({ patientId, appointmentId });

      expect(res.status).toBe(409);
    });

    it('recusa ficha apontando para consulta de outro paciente', async () => {
      const outroPaciente = await request(app.getHttpServer())
        .post('/patients')
        .set(auth())
        .send({
          name: 'Outro Paciente E2E',
          cpf: '52998224725',
          phone: '11955550001',
          email: 'outro.paciente@e2e.test',
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/clinical-records')
        .set(auth())
        .send({ patientId: outroPaciente.body.id, appointmentId });

      expect(res.status).toBe(400);
    });

    it('salva o rascunho e marca o paciente como cirúrgico', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/clinical-records/${recordId}`)
        .set(auth())
        .send({
          physicalExam: '<p>Crepitação à mobilização.</p>',
          conduct: '<p>Indicada artroplastia.</p>',
          surgicalIndication: true,
        })
        .expect(200);

      expect(res.body.surgicalIndication).toBe(true);
    });

    it('finaliza a ficha, conclui a consulta e cria a SC em Pendente', async () => {
      const res = await request(app.getHttpServer())
        .post(`/clinical-records/${recordId}/finalize`)
        .set(auth())
        .expect(201);

      expect(res.body.finalizedAt).toBeTruthy();

      const consulta = await request(app.getHttpServer())
        .get(`/appointments/${appointmentId}`)
        .set(auth())
        .expect(200);
      expect(consulta.body.status).toBe('completed');

      const [ficha] = await dataSource.query(
        `SELECT surgery_request_id FROM clinical_records WHERE id = $1`,
        [recordId],
      );
      expect(ficha.surgery_request_id).toBeTruthy();

      const [sc] = await dataSource.query(
        `SELECT status, patient_id, doctor_id FROM surgery_requests WHERE id = $1`,
        [ficha.surgery_request_id],
      );
      expect(sc.status).toBe(1); // PENDING
      expect(sc.patient_id).toBe(patientId);
      expect(sc.doctor_id).toBe(doctorId);
    });

    it('ficha finalizada é imutável', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/clinical-records/${recordId}`)
        .set(auth())
        .send({ anamnesis: 'tentativa de reescrever' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('finalizado');
    });

    it('ficha finalizada não pode ser excluída', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/clinical-records/${recordId}`)
        .set(auth());

      expect(res.status).toBe(400);
    });

    it('finalizar de novo não cria uma segunda SC', async () => {
      await request(app.getHttpServer())
        .post(`/clinical-records/${recordId}/finalize`)
        .set(auth())
        .expect(400);

      const [{ count }] = await dataSource.query(
        `SELECT COUNT(*)::int AS count FROM surgery_requests WHERE patient_id = $1`,
        [patientId],
      );
      expect(count).toBe(1);
    });

    it('D-06: consulta com ficha vinculada não pode ser excluída', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/appointments/${appointmentId}`)
        .set(auth());

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('ficha de atendimento');
    });

    it('a ficha aparece na timeline do paciente', async () => {
      const res = await request(app.getHttpServer())
        .get('/clinical-records')
        .query({ patientId })
        .set(auth())
        .expect(200);

      expect(res.body.map((r: { id: string }) => r.id)).toContain(recordId);
    });

    it('o outro tenant não enxerga a ficha', async () => {
      const res = await request(app.getHttpServer())
        .get(`/clinical-records/${recordId}`)
        .set({ Authorization: `Bearer ${outroToken}` });

      expect([403, 404]).toContain(res.status);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Bloco 10 — D-02 / FN-06: finalizar ficha de consulta cancelada
  // ──────────────────────────────────────────────────────────────────────────

  describe('D-02: finalizar ficha de consulta cancelada', () => {
    it('preserva o status "cancelled" e o motivo', async () => {
      const consulta = await agendar(maisMinutos(BASE, 5760));
      expect(consulta.status).toBe(201);
      const appointmentId = consulta.body.id;

      const ficha = await request(app.getHttpServer())
        .post('/clinical-records')
        .set(auth())
        .send({ patientId, appointmentId, anamnesis: 'rascunho' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/appointments/${appointmentId}/status`)
        .set(auth())
        .send({ status: 'cancelled', cancellationReason: 'paciente faltou' })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/clinical-records/${ficha.body.id}/finalize`)
        .set(auth())
        .expect(201);

      const depois = await request(app.getHttpServer())
        .get(`/appointments/${appointmentId}`)
        .set(auth())
        .expect(200);

      expect(depois.body.status).toBe('cancelled');
      expect(depois.body.cancellationReason).toBe('paciente faltou');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Bloco 16 — Atos privativos do médico
  // ──────────────────────────────────────────────────────────────────────────

  describe('Permissões — escrever na ficha é ato do médico', () => {
    let secretariaToken: string;

    beforeAll(async () => {
      const email = `secretaria.${Date.now()}@inexci.test`;
      await request(app.getHttpServer())
        .post('/users/collaborators')
        .set(auth())
        .send({
          name: 'Secretaria E2E',
          email,
          phone: '11944440001',
          permissions: ['agenda', 'atendimento'],
        })
        .expect(201);

      await dataSource.query(
        `UPDATE users
            SET status = 'active',
                password = $2,
                email_verified = true,
                email_verified_at = NOW(),
                privacy_policy_accepted_at = NOW(),
                terms_of_use_accepted_at = NOW()
          WHERE email = $1`,
        [email, require('bcrypt').hashSync('Senha@12345', 10)],
      );

      const [colaborador] = await dataSource.query(
        `SELECT id FROM users WHERE email = $1`,
        [email],
      );
      await dataSource.query(
        `INSERT INTO user_doctor_accesses (user_id, doctor_user_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [colaborador.id, doctorId],
      );

      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'Senha@12345' })
        .expect(201);
      secretariaToken = login.body.access_token;
    });

    it('a secretária agenda consulta normalmente', async () => {
      const res = await request(app.getHttpServer())
        .post('/appointments')
        .set({ Authorization: `Bearer ${secretariaToken}` })
        .send({
          patientId,
          doctorId,
          scheduledAt: maisMinutos(BASE, 7200),
        });

      expect(res.status).toBe(201);
      await excluirConsulta(res.body.id);
    });

    it('a secretária não cria ficha de atendimento', async () => {
      const res = await request(app.getHttpServer())
        .post('/clinical-records')
        .set({ Authorization: `Bearer ${secretariaToken}` })
        .send({ patientId, anamnesis: 'não deveria gravar' });

      expect(res.status).toBe(403);
    });

    it('D-16: a secretária não cria modelo de anamnese', async () => {
      const res = await request(app.getHttpServer())
        .post('/clinical-records/templates')
        .set({ Authorization: `Bearer ${secretariaToken}` })
        .send({ name: 'Modelo indevido', anamnesis: 'x' });

      expect(res.status).toBe(403);
    });

    it('a secretária lê a timeline do paciente', async () => {
      await request(app.getHttpServer())
        .get('/clinical-records')
        .query({ patientId })
        .set({ Authorization: `Bearer ${secretariaToken}` })
        .expect(200);
    });
  });
});
