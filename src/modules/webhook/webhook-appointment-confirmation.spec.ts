import { WebhookService } from './webhook.service';
import { AppointmentStatus } from 'src/database/entities/appointment.entity';

/**
 * Resposta do paciente ao template `appointment_confirmation`.
 *
 * A consulta é localizada pelo telefone do remetente dentro da janela do
 * lembrete — o webhook do Twilio não entrega id de consulta. Os ids de botão
 * próprios (`consulta_confirmar`/`consulta_cancelar`) é que separam este fluxo
 * do agendamento cirúrgico, que usa `opcao_*`.
 */
describe('WebhookService — confirmação de consulta', () => {
  const configService = { get: jest.fn().mockReturnValue('') };
  const surgeryRequestRepository = {
    getRepository: jest.fn(),
    update: jest.fn(),
  };
  const activityRepository = { create: jest.fn() };
  let whatsappService: { sendMessage: jest.Mock; sendTemplate: jest.Mock };
  let appointmentRepository: {
    findAtivaPorTelefone: jest.Mock;
    update: jest.Mock;
  };
  let notificationsService: { notifyAppointmentPatientResponse: jest.Mock };
  let service: WebhookService;

  const consulta = {
    id: 'appt-1',
    ownerId: 'acc-1',
    doctorId: 'doctor-1',
    status: AppointmentStatus.SCHEDULED,
    scheduledAt: new Date('2026-08-01T17:00:00.000Z'),
    durationMinutes: 30,
    patient: { name: 'Ana Souza' },
  };

  const evento = (buttonPayload: string, buttonText = '') => ({
    from: 'whatsapp:+5511998877665',
    messageSid: 'SM1',
    buttonPayload,
    buttonText,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    whatsappService = {
      sendMessage: jest.fn().mockResolvedValue(undefined),
      sendTemplate: jest.fn().mockResolvedValue(undefined),
    };
    appointmentRepository = {
      findAtivaPorTelefone: jest.fn().mockResolvedValue({ ...consulta }),
      update: jest.fn().mockResolvedValue({}),
    };
    notificationsService = {
      notifyAppointmentPatientResponse: jest.fn().mockResolvedValue(undefined),
    };
    service = new WebhookService(
      configService as any,
      surgeryRequestRepository as any,
      activityRepository as any,
      whatsappService as any,
      appointmentRepository as any,
      notificationsService as any,
    );
  });

  it('confirma a consulta quando o paciente aperta Confirmo', async () => {
    const tratou = await service.tryHandleAppointmentConfirmation(
      evento('consulta_confirmar'),
    );

    expect(tratou).toBe(true);
    expect(appointmentRepository.update).toHaveBeenCalledWith('appt-1', {
      status: AppointmentStatus.CONFIRMED,
    });
    expect(whatsappService.sendMessage).toHaveBeenCalledWith(
      'whatsapp:+5511998877665',
      expect.stringContaining('Ana Souza'),
    );
  });

  it('cancela a consulta e registra o motivo quando o paciente aperta Cancelar', async () => {
    const tratou = await service.tryHandleAppointmentConfirmation(
      evento('consulta_cancelar'),
    );

    expect(tratou).toBe(true);
    expect(appointmentRepository.update).toHaveBeenCalledWith('appt-1', {
      status: AppointmentStatus.CANCELLED,
      cancellationReason: expect.stringContaining('paciente'),
    });
  });

  /**
   * O paciente acabou de cancelar apertando o botão — reenviar o template
   * `appointment_cancelled` seria avisá-lo do que ele mesmo fez.
   */
  it('não reenvia o template de cancelamento para quem cancelou pelo botão', async () => {
    await service.tryHandleAppointmentConfirmation(evento('consulta_cancelar'));

    expect(whatsappService.sendTemplate).not.toHaveBeenCalled();
  });

  it('avisa o médico e quem tem acesso à agenda dele', async () => {
    await service.tryHandleAppointmentConfirmation(evento('consulta_cancelar'));

    expect(
      notificationsService.notifyAppointmentPatientResponse,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: 'appt-1',
        ownerId: 'acc-1',
        doctorId: 'doctor-1',
        patientName: 'Ana Souza',
        response: 'cancelled',
      }),
    );
  });

  // ─── Localização da consulta ─────────────────────────────────────────────

  it('procura pelas variantes do telefone e numa janela que cobre o lembrete', async () => {
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-08-01T12:00:00.000Z').getTime());

    await service.tryHandleAppointmentConfirmation(
      evento('consulta_confirmar'),
    );

    const [telefones, janela] =
      appointmentRepository.findAtivaPorTelefone.mock.calls[0];
    expect(telefones).toContain('5511998877665');
    expect(telefones).toContain('11998877665');
    // O lembrete sai até 24h antes; a resposta pode chegar já com a consulta
    // recém-passada, então a janela abre um pouco antes de agora.
    expect(janela.from.getTime()).toBeLessThan(Date.now());
    expect(janela.to.getTime()).toBeGreaterThan(Date.now() + 24 * 3600 * 1000);

    jest.restoreAllMocks();
  });

  /**
   * O status já foi gravado. Deixar a exceção subir fazia o controller cair no
   * `catch` e entregar o clique do botão ao orquestrador de IA, que respondia
   * ao paciente qualquer coisa sobre uma consulta que já estava cancelada.
   */
  it('continua tratando a resposta quando o aviso ao paciente falha', async () => {
    whatsappService.sendMessage.mockRejectedValue(new Error('twilio fora'));

    await expect(
      service.tryHandleAppointmentConfirmation(evento('consulta_cancelar')),
    ).resolves.toBe(true);

    expect(appointmentRepository.update).toHaveBeenCalledWith(
      'appt-1',
      expect.objectContaining({ status: AppointmentStatus.CANCELLED }),
    );
  });

  it('devolve false quando o paciente não tem consulta ativa na janela', async () => {
    appointmentRepository.findAtivaPorTelefone.mockResolvedValue(null);

    const tratou = await service.tryHandleAppointmentConfirmation(
      evento('consulta_confirmar'),
    );

    expect(tratou).toBe(false);
    expect(appointmentRepository.update).not.toHaveBeenCalled();
  });

  it('devolve false para botão que não é dos dois deste template', async () => {
    const tratou = await service.tryHandleAppointmentConfirmation(
      evento('outro_botao'),
    );

    expect(tratou).toBe(false);
    expect(appointmentRepository.findAtivaPorTelefone).not.toHaveBeenCalled();
  });

  it('devolve false quando o remetente não tem telefone utilizável', async () => {
    const tratou = await service.tryHandleAppointmentConfirmation({
      from: 'whatsapp:',
      messageSid: 'SM1',
      buttonPayload: 'consulta_confirmar',
      buttonText: '',
    });

    expect(tratou).toBe(false);
    expect(appointmentRepository.findAtivaPorTelefone).not.toHaveBeenCalled();
  });

  /**
   * `opcao_1`/`opcao_2` são do template de agendamento cirúrgico. Aceitá-los
   * aqui traria de volta a colisão que os ids próprios do template de consulta
   * resolveram.
   */
  it('ignora os ids do template de agendamento cirúrgico', async () => {
    for (const payload of ['opcao_1', 'opcao_2', 'opcao_3']) {
      await expect(
        service.tryHandleAppointmentConfirmation(evento(payload)),
      ).resolves.toBe(false);
    }

    expect(appointmentRepository.findAtivaPorTelefone).not.toHaveBeenCalled();
    expect(appointmentRepository.update).not.toHaveBeenCalled();
  });

  it('aceita o texto do botão quando o payload vem vazio', async () => {
    const tratou = await service.tryHandleAppointmentConfirmation(
      evento('', 'Confirmo'),
    );

    expect(tratou).toBe(true);
    expect(appointmentRepository.update).toHaveBeenCalledWith('appt-1', {
      status: AppointmentStatus.CONFIRMED,
    });
  });

  // ─── Local do atendimento na resposta ────────────────────────────────────

  /**
   * A janela de 24h abre quando o paciente aperta o botão — é a única chance de
   * mandar o endereço sem gastar template (variável opcional não cabe num).
   */
  it('informa nome e endereço da unidade ao confirmar', async () => {
    appointmentRepository.findAtivaPorTelefone.mockResolvedValue({
      ...consulta,
      clinic: {
        name: 'Clínica Vida',
        address: 'Rua das Flores',
        addressNumber: '120',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
      },
    });

    await service.tryHandleAppointmentConfirmation(
      evento('consulta_confirmar'),
    );

    const [, texto] = whatsappService.sendMessage.mock.calls[0];
    expect(texto).toContain('Clínica Vida');
    expect(texto).toContain('Rua das Flores, 120 - Centro, São Paulo/SP');
  });

  it('informa só o nome quando a unidade não tem endereço cadastrado', async () => {
    appointmentRepository.findAtivaPorTelefone.mockResolvedValue({
      ...consulta,
      clinic: {
        name: 'Clínica Vida',
        address: null,
        addressNumber: null,
        neighborhood: null,
        city: null,
        state: null,
      },
    });

    await service.tryHandleAppointmentConfirmation(
      evento('consulta_confirmar'),
    );

    const [, texto] = whatsappService.sendMessage.mock.calls[0];
    expect(texto).toContain('Clínica Vida');
    expect(texto).not.toContain('—');
  });

  it('não menciona local quando a consulta não tem unidade vinculada', async () => {
    await service.tryHandleAppointmentConfirmation(
      evento('consulta_confirmar'),
    );

    const [, texto] = whatsappService.sendMessage.mock.calls[0];
    expect(texto).not.toContain('📍');
  });

  /** Quem cancelou não precisa saber onde era. */
  it('não menciona local no cancelamento', async () => {
    appointmentRepository.findAtivaPorTelefone.mockResolvedValue({
      ...consulta,
      clinic: { name: 'Clínica Vida', address: 'Rua das Flores' },
    });

    await service.tryHandleAppointmentConfirmation(evento('consulta_cancelar'));

    const [, texto] = whatsappService.sendMessage.mock.calls[0];
    expect(texto).not.toContain('Clínica Vida');
  });
});
