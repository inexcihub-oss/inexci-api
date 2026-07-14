const recordAiToolDurationMock = jest.fn();

jest.mock('./metrics.util', () => ({
  recordAiToolDuration: (...args: unknown[]) =>
    recordAiToolDurationMock(...args),
}));

import { AiToolMetricsListener } from './ai-tool-metrics.listener';

describe('AiToolMetricsListener', () => {
  let listener: AiToolMetricsListener;

  beforeEach(() => {
    recordAiToolDurationMock.mockClear();
    listener = new AiToolMetricsListener();
  });

  it('registra a duração da tool em caso de sucesso', () => {
    listener.onToolSucceeded({
      toolName: 'search_procedures',
      durationMs: 120,
    });

    expect(recordAiToolDurationMock).toHaveBeenCalledWith(120, {
      tool: 'search_procedures',
    });
  });

  it('registra a duração da tool em caso de falha', () => {
    listener.onToolFailed({
      toolName: 'sc_draft_commit',
      durationMs: 340,
    });

    expect(recordAiToolDurationMock).toHaveBeenCalledWith(340, {
      tool: 'sc_draft_commit',
    });
  });
});
