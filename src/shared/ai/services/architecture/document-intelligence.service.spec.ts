import { ConfigService } from '@nestjs/config';
import { AiRedisService } from '../ai-redis.service';
import { DocumentIntelligenceService } from './document-intelligence.service';

describe('DocumentIntelligenceService', () => {
  const aiRedisMock = {
    cacheGet: jest.fn().mockResolvedValue(null),
    cacheSet: jest.fn().mockResolvedValue(undefined),
  } as unknown as AiRedisService;
  const configMock = {
    get: jest.fn((key: string, fallback: number) => fallback),
  } as unknown as ConfigService;

  const service = new DocumentIntelligenceService(aiRedisMock, configMock);

  it('gera extraction result com confidence global e por campo', () => {
    const result = service.buildExtractionResult({
      fingerprint: 'doc-1',
      classification: {
        kind: 'surgery_request',
        confidence: 0.82,
        suggestedDocumentType: 'medical_report',
        ambiguity: 'sem ambiguidade relevante',
        extracted: {
          patient: { name: 'Maria Silva' },
          hospital: 'Santa Casa',
          tuss: [{ code: '30715091', description: 'Teste' }],
          diagnosis: 'Teste',
          suggestedProcedureName: 'Artrodese',
          laudoText: 'Laudo',
        },
        durationMs: 1200,
        model: 'gpt-5-nano',
      },
      ocrConfidence: 0.7,
      textLength: 1500,
      usedVisionFallback: false,
      reasons: [],
    });

    expect(result.globalConfidence).toBeGreaterThan(0.7);
    expect(result.fieldConfidence.patient).toBeDefined();
    expect(result.selectiveVisionRecommended).toBe(false);
  });
});
