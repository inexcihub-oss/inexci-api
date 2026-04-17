import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OpenaiService } from './openai.service';

const mockCreate = jest.fn();
const mockEmbeddingsCreate = jest.fn();

jest.mock('openai', () => {
  const OpenAIMock = jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
    embeddings: {
      create: mockEmbeddingsCreate,
    },
  }));
  return { default: OpenAIMock };
});

describe('OpenaiService', () => {
  let service: OpenaiService;

  const configServiceMock = {
    get: jest.fn((key: string, def?: any) => {
      const map: Record<string, any> = {
        OPENAI_API_KEY: 'test-key',
        OPENAI_MODEL: 'gpt-4o',
        OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
      };
      return map[key] ?? def;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenaiService,
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    service = module.get<OpenaiService>(OpenaiService);
    jest.clearAllMocks();
  });

  it('deve chamar chatCompletion corretamente', async () => {
    const mockResponse = {
      choices: [{ message: { content: 'Resposta da IA', tool_calls: null } }],
    };
    mockCreate.mockResolvedValue(mockResponse);

    const result = await service.chatCompletion({
      messages: [{ role: 'user', content: 'Olá' }],
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockResponse);
  });

  it('deve criar embedding corretamente', async () => {
    const mockEmbedding = [0.1, 0.2, 0.3];
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: mockEmbedding }],
    });

    const result = await service.createEmbedding('texto de teste');

    expect(result).toEqual(mockEmbedding);
    expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1);
  });

  it('deve fazer retry em caso de erro 500', async () => {
    const error = new Error('Internal Server Error');
    (error as any).status = 500;
    mockCreate
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'OK após retry' } }],
      });

    const result = await service.chatCompletion({
      messages: [{ role: 'user', content: 'Teste retry' }],
    });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.choices[0].message.content).toBe('OK após retry');
  });

  it('deve lançar erro sem retry para status 400', async () => {
    const error = new Error('Bad Request');
    (error as any).status = 400;
    mockCreate.mockRejectedValue(error);

    await expect(
      service.chatCompletion({ messages: [{ role: 'user', content: 'Teste' }] }),
    ).rejects.toThrow('Bad Request');

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
