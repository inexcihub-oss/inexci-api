import { ConfigService } from '@nestjs/config';
import { ModelGatewayService } from './model-gateway.service';
import { ModelTierConfigService } from './model-tier.config';
import { OpenaiService } from '../services/openai.service';

function makeConfigService(env: Record<string, string>): ConfigService {
  return {
    get: (key: string, defaultValue?: unknown) =>
      env[key] ?? (defaultValue as string | undefined),
  } as unknown as ConfigService;
}

describe('ModelGatewayService', () => {
  it('encaminha tier=cheap para OpenaiService com modelo correto', async () => {
    const tierConfig = new ModelTierConfigService(
      makeConfigService({ AI_TIER_CHEAP: 'openai:gpt-4o-mini' }),
    );
    const openai = {
      chatCompletion: jest.fn().mockResolvedValue({
        id: 'cmpl_1',
        model: 'gpt-4o-mini',
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
        choices: [],
      }),
      createEmbedding: jest.fn(),
    } as unknown as OpenaiService;

    const gateway = new ModelGatewayService(tierConfig, openai);
    const resp = await gateway.complete({
      tier: 'cheap',
      messages: [{ role: 'user', content: 'oi' }],
    });

    expect(resp.tier).toBe('cheap');
    expect(resp.model).toBe('gpt-4o-mini');
    expect(openai.chatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini' }),
    );
  });

  it('omite tools quando tier não suporta (vision)', async () => {
    const tierConfig = new ModelTierConfigService(makeConfigService({}));
    const openai = {
      chatCompletion: jest.fn().mockResolvedValue({
        model: 'gpt-4o',
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        choices: [],
      }),
      createEmbedding: jest.fn(),
    } as unknown as OpenaiService;
    const gateway = new ModelGatewayService(tierConfig, openai);

    await gateway.complete({
      tier: 'vision',
      messages: [],
      tools: [{ type: 'function', function: { name: 't', parameters: {} as any } } as any],
    });

    const callArgs = (openai.chatCompletion as jest.Mock).mock.calls[0][0];
    expect(callArgs.tools).toBeUndefined();
  });

  it('embed delega ao createEmbedding', async () => {
    const tierConfig = new ModelTierConfigService(makeConfigService({}));
    const openai = {
      chatCompletion: jest.fn(),
      createEmbedding: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    } as unknown as OpenaiService;
    const gateway = new ModelGatewayService(tierConfig, openai);

    const resp = await gateway.embed({ input: 'texto' });
    expect(resp.vector).toEqual([0.1, 0.2, 0.3]);
    expect(resp.tier).toBe('embedding');
  });
});
