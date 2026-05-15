import { ConfigService } from '@nestjs/config';
import { AiRedisService } from '../ai-redis.service';
import { AudioPipelineService } from './audio-pipeline.service';

describe('AudioPipelineService', () => {
  const aiRedisMock = {
    cacheGet: jest.fn().mockResolvedValue(null),
    cacheSet: jest.fn().mockResolvedValue(undefined),
  } as unknown as AiRedisService;
  const configMock = {
    get: jest.fn((key: string, fallback: number) => fallback),
  } as unknown as ConfigService;

  const service = new AudioPipelineService(aiRedisMock, configMock);

  it('comprime transcricao longa e extrai entidades', () => {
    const result = service.compressTranscription({
      fingerprint: 'abc',
      transcription: {
        text: 'Quero criar uma SC para Maria. Meu email e teste@inexci.com e o TUSS 30715091. Tambem preciso agendar a cirurgia para semana que vem. O hospital sera o Santa Casa. Obrigado.',
        provider: 'openai',
        language: 'pt-BR',
        confidence: 0.81,
        durationSeconds: 12,
        latencyMs: 800,
      },
    });

    expect(result.semanticTranscript.length).toBeLessThanOrEqual(
      result.normalizedTranscript.length,
    );
    expect(result.extractedEntities.some((item) => item.type === 'email')).toBe(
      true,
    );
    expect(result.inferredIntent).toBe('create_sc');
  });
});
