const recordMock = jest.fn();
const addMock = jest.fn();
const createHistogramMock = jest.fn().mockReturnValue({ record: recordMock });
const createCounterMock = jest.fn().mockReturnValue({ add: addMock });
const getMeterMock = jest.fn().mockReturnValue({
  createHistogram: createHistogramMock,
  createCounter: createCounterMock,
});

jest.mock('@opentelemetry/api', () => ({
  metrics: { getMeter: (...args: unknown[]) => getMeterMock(...args) },
}));

import {
  METER_NAME,
  getMeter,
  recordAiProcessingDuration,
  recordAiToolDuration,
  recordOpenaiRequestDuration,
  recordOpenaiTokens,
  recordWorkflowTransition,
  recordQueueJobDuration,
} from './metrics.util';

describe('metrics.util', () => {
  beforeEach(() => {
    recordMock.mockClear();
    addMock.mockClear();
  });

  it('cria o meter com o nome padrão do serviço', () => {
    expect(getMeter()).toBeDefined();
    expect(getMeterMock).toHaveBeenCalledWith(METER_NAME);
  });

  it('cria os 4 histogramas e os 2 contadores customizados na carga do módulo', () => {
    expect(createHistogramMock).toHaveBeenCalledWith(
      'inexci.ai.processing.duration',
      expect.objectContaining({ unit: 'ms' }),
    );
    expect(createHistogramMock).toHaveBeenCalledWith(
      'inexci.ai.tool.duration',
      expect.objectContaining({ unit: 'ms' }),
    );
    expect(createHistogramMock).toHaveBeenCalledWith(
      'inexci.openai.request.duration',
      expect.objectContaining({ unit: 'ms' }),
    );
    expect(createHistogramMock).toHaveBeenCalledWith(
      'inexci.queue.job.duration',
      expect.objectContaining({ unit: 'ms' }),
    );
    expect(createCounterMock).toHaveBeenCalledWith(
      'inexci.openai.tokens',
      expect.any(Object),
    );
    expect(createCounterMock).toHaveBeenCalledWith(
      'inexci.workflow.transition.count',
      expect.any(Object),
    );
  });

  it('recordAiProcessingDuration repassa duração e atributos ao histograma', () => {
    recordAiProcessingDuration(123, {
      channel: 'whatsapp',
      intent: 'create_sc',
      hadTools: true,
    });

    expect(recordMock).toHaveBeenCalledWith(123, {
      channel: 'whatsapp',
      intent: 'create_sc',
      hadTools: true,
    });
  });

  it('recordAiToolDuration repassa duração e nome da tool', () => {
    recordAiToolDuration(45, { tool: 'search_procedures' });

    expect(recordMock).toHaveBeenCalledWith(45, {
      tool: 'search_procedures',
    });
  });

  it('recordOpenaiRequestDuration repassa duração, model e stage', () => {
    recordOpenaiRequestDuration(789, { model: 'gpt-4o', stage: 'chat' });

    expect(recordMock).toHaveBeenCalledWith(789, {
      model: 'gpt-4o',
      stage: 'chat',
    });
  });

  it('recordOpenaiTokens soma no contador com model/stage/type', () => {
    recordOpenaiTokens(50, {
      model: 'gpt-4o-mini',
      stage: 'doc_classifier',
      type: 'prompt',
    });

    expect(addMock).toHaveBeenCalledWith(50, {
      model: 'gpt-4o-mini',
      stage: 'doc_classifier',
      type: 'prompt',
    });
  });

  it('recordWorkflowTransition normaliza from/to (enum numérico) para string', () => {
    recordWorkflowTransition({ from: 1, to: 2, result: 'allowed' });

    expect(addMock).toHaveBeenCalledWith(1, {
      from: '1',
      to: '2',
      result: 'allowed',
    });
  });

  it('recordWorkflowTransition aceita result "blocked"', () => {
    recordWorkflowTransition({
      from: 'SENT',
      to: 'IN_ANALYSIS',
      result: 'blocked',
    });

    expect(addMock).toHaveBeenCalledWith(1, {
      from: 'SENT',
      to: 'IN_ANALYSIS',
      result: 'blocked',
    });
  });

  it('recordQueueJobDuration repassa duração, fila e status', () => {
    recordQueueJobDuration(250, { queue: 'mail', status: 'completed' });

    expect(recordMock).toHaveBeenCalledWith(250, {
      queue: 'mail',
      status: 'completed',
    });
  });

  it('recordQueueJobDuration aceita status "failed"', () => {
    recordQueueJobDuration(500, {
      queue: 'whatsapp-messages',
      status: 'failed',
    });

    expect(recordMock).toHaveBeenCalledWith(500, {
      queue: 'whatsapp-messages',
      status: 'failed',
    });
  });
});
