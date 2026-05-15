import OpenAI from 'openai';
import { ToolPolicyService } from './tool-policy.service';

describe('ToolPolicyService', () => {
  const service = new ToolPolicyService();

  it('bloqueia mutacao complexa sem draft e sem plan_actions', () => {
    const blocked = service.evaluatePlanFirstGuard({
      activeDraftType: null,
      toolCalls: [
        {
          id: '1',
          type: 'function',
          function: {
            name: 'draft_update',
            arguments: '{}',
          },
        } as OpenAI.ChatCompletionMessageToolCall,
      ],
    });

    expect(blocked.has('1')).toBe(true);
  });

  it('permite mutacao complexa quando plan_actions esta presente', () => {
    const blocked = service.evaluatePlanFirstGuard({
      activeDraftType: null,
      toolCalls: [
        {
          id: '1',
          type: 'function',
          function: {
            name: 'plan_actions',
            arguments: '{}',
          },
        } as OpenAI.ChatCompletionMessageToolCall,
        {
          id: '2',
          type: 'function',
          function: {
            name: 'draft_update',
            arguments: '{}',
          },
        } as OpenAI.ChatCompletionMessageToolCall,
      ],
    });

    expect(blocked.size).toBe(0);
  });
});
