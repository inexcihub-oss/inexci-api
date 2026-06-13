import { AudioExtractorService } from './audio-extractor.service';
import { AudioEntityExtractor } from './audio-entity-extractor';
import { SttCacheService } from './stt-cache.service';
import { TranscriptionService } from '../transcription/transcription.service';
import { AiRedisService } from '../services/ai-redis.service';

function makeRedis(): AiRedisService {
  const store = new Map<string, unknown>();
  return {
    cacheGet: jest.fn(async (k: string) => store.get(k) ?? null),
    cacheSet: jest.fn(async (k: string, v: unknown) => {
      store.set(k, v);
    }),
  } as unknown as AiRedisService;
}

describe('AudioExtractorService', () => {
  it('extract live: chama transcription e popula entities/summary', async () => {
    const transcribe = jest.fn().mockResolvedValue({
      text: 'criar uma SC para Maria com TUSS 30602114',
      provider: 'faster_whisper',
      latencyMs: 100,
      language: 'pt-BR',
      confidence: 0.9,
    });
    const transcription = {
      transcribe,
    } as unknown as TranscriptionService;
    const cache = new SttCacheService(makeRedis());
    const ext = new AudioExtractorService(
      cache,
      transcription,
      new AudioEntityExtractor(),
    );

    const result = await ext.extract({
      audioBuffer: Buffer.from('audio bytes'),
      mimeType: 'audio/ogg',
    });

    expect(transcribe).toHaveBeenCalled();
    expect(result.source).toBe('live');
    expect(result.entities.tuss_hint).toEqual(['30602114']);
    expect(result.intent_hint).toBe('create_sc');
  });

  it('extract aproveita cache no segundo call', async () => {
    const transcribe = jest.fn().mockResolvedValue({
      text: 'oi',
      provider: 'faster_whisper',
      latencyMs: 50,
      language: 'pt-BR',
      confidence: 0.8,
    });
    const transcription = {
      transcribe,
    } as unknown as TranscriptionService;
    const cache = new SttCacheService(makeRedis());
    const ext = new AudioExtractorService(
      cache,
      transcription,
      new AudioEntityExtractor(),
    );

    const audioBuffer = Buffer.from('mesmo audio');
    const r1 = await ext.extract({ audioBuffer, mimeType: 'audio/ogg' });
    const r2 = await ext.extract({ audioBuffer, mimeType: 'audio/ogg' });

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(r1.source).toBe('live');
    expect(r2.source).toBe('cache');
    expect(r2.hash).toBe(r1.hash);
  });

  it('summary é gerado quando transcript > threshold', async () => {
    const longText = 'a '.repeat(400) + 'TUSS 30602114';
    const transcribe = jest.fn().mockResolvedValue({
      text: longText,
      provider: 'faster_whisper',
      latencyMs: 50,
      language: 'pt-BR',
      confidence: 0.8,
    });
    const transcription = { transcribe } as unknown as TranscriptionService;
    const cache = new SttCacheService(makeRedis());
    const ext = new AudioExtractorService(
      cache,
      transcription,
      new AudioEntityExtractor(),
    );

    const r = await ext.extract({
      audioBuffer: Buffer.from('long'),
      mimeType: 'audio/ogg',
    });
    expect(r.summary_for_main_agent).not.toBeNull();
    expect(r.summary_for_main_agent).toContain('TUSS=30602114');
  });
});
