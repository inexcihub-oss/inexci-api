import { WebhookService } from './webhook.service';
import { PhoneNormalizerService } from 'src/shared/ai/services/orchestrator/phone-normalizer.service';

describe('WebhookService — escolha de data da cirurgia pelo paciente', () => {
  const configService = { get: jest.fn().mockReturnValue('') };
  const phoneNormalizer = new PhoneNormalizerService({} as any);
  let schedulingHandler: { registerPatientDateSelection: jest.Mock };
  let whatsappService: { sendMessage: jest.Mock; sendTemplate: jest.Mock };
  let service: WebhookService;

  const evento = (buttonPayload: string) => ({
    from: 'whatsapp:+5511998877665',
    messageSid: 'SM1',
    buttonPayload,
    buttonText: '',
  });

  beforeEach(() => {
    schedulingHandler = { registerPatientDateSelection: jest.fn() };
    whatsappService = {
      sendMessage: jest.fn().mockResolvedValue(undefined),
      sendTemplate: jest.fn().mockResolvedValue(undefined),
    };
    service = new WebhookService(
      configService as any,
      schedulingHandler as any,
      phoneNormalizer,
      whatsappService as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('delega a gravação ao SchedulingHandler com o índice e as variantes só-dígitos do telefone', async () => {
    schedulingHandler.registerPatientDateSelection.mockResolvedValue({
      kind: 'selected',
      request: {
        id: 'sc-1',
        protocol: 'P-1',
        patient: { name: 'Ana' },
        doctor: { name: 'Dr. X', phone: '+5511900000000' },
      },
      selectedIndex: 1,
      selectedIso: '2026-11-10T13:00:00.000Z',
    });

    await expect(
      service.tryHandleSchedulingSelection(evento('opcao_2')),
    ).resolves.toBe(true);

    const [params] =
      schedulingHandler.registerPatientDateSelection.mock.calls[0];
    expect(params.selectedIndex).toBe(1);
    expect(params.from).toBe('whatsapp:+5511998877665');
    expect(params.phoneDigitCandidates).toEqual(
      expect.arrayContaining(['5511998877665', '11998877665']),
    );
    expect(
      params.phoneDigitCandidates.every((c: string) => /^\d+$/.test(c)),
    ).toBe(true);
    expect(whatsappService.sendTemplate).toHaveBeenCalledTimes(1);
    expect(whatsappService.sendMessage).toHaveBeenCalledWith(
      'whatsapp:+5511998877665',
      expect.stringContaining('Recebemos sua escolha'),
    );
  });

  it('não grava nada e pede contato com a clínica quando a resposta é ambígua', async () => {
    schedulingHandler.registerPatientDateSelection.mockResolvedValue({
      kind: 'ambiguous',
    });

    await expect(
      service.tryHandleSchedulingSelection(evento('opcao_1')),
    ).resolves.toBe(true);

    expect(whatsappService.sendTemplate).not.toHaveBeenCalled();
    expect(whatsappService.sendMessage).toHaveBeenCalledWith(
      'whatsapp:+5511998877665',
      expect.stringContaining('mais de uma solicitação'),
    );
  });

  it('avisa quando não há solicitação em agendamento', async () => {
    schedulingHandler.registerPatientDateSelection.mockResolvedValue({
      kind: 'not_found',
    });

    await service.tryHandleSchedulingSelection(evento('opcao_1'));

    expect(whatsappService.sendMessage).toHaveBeenCalledWith(
      'whatsapp:+5511998877665',
      expect.stringContaining('Não localizei'),
    );
  });

  it('ignora botões que não são de opção de data', async () => {
    await expect(
      service.tryHandleSchedulingSelection(evento('consulta_confirmar')),
    ).resolves.toBe(false);
    expect(
      schedulingHandler.registerPatientDateSelection,
    ).not.toHaveBeenCalled();
  });
});
