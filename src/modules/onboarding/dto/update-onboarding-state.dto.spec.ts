import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateOnboardingStateDto } from './update-onboarding-state.dto';

async function erros(payload: Record<string, unknown>) {
  const dto = plainToInstance(UpdateOnboardingStateDto, payload);
  const resultado = await validate(dto, { whitelist: true });
  return resultado.map((e) => e.property);
}

describe('UpdateOnboardingStateDto', () => {
  it('aceita um patch válido', async () => {
    expect(
      await erros({
        status: 'in_progress',
        welcomeSeenAt: '2026-08-21T14:02:11.000Z',
        completedSteps: { 'criar-solicitacao': '2026-08-21T14:09:40.000Z' },
        toursSeen: { solicitacoes: '2026-08-21T14:09:40.000Z' },
      }),
    ).toEqual([]);
  });

  it('aceita patch vazio', async () => {
    expect(await erros({})).toEqual([]);
  });

  it('rejeita chave desconhecida em completedSteps', async () => {
    expect(
      await erros({
        completedSteps: { 'passo-que-nao-existe': '2026-08-21T14:00:00.000Z' },
      }),
    ).toEqual(['completedSteps']);
  });

  it('rejeita chave desconhecida em toursSeen', async () => {
    expect(
      await erros({ toursSeen: { trilha_inventada: '2026-08-21T14:00:00.000Z' } }),
    ).toEqual(['toursSeen']);
  });

  it('rejeita valor que não é timestamp', async () => {
    expect(
      await erros({ completedSteps: { 'criar-solicitacao': 'ontem' } }),
    ).toEqual(['completedSteps']);
  });

  it('rejeita array no lugar do mapa', async () => {
    expect(await erros({ completedSteps: ['criar-solicitacao'] })).toEqual([
      'completedSteps',
    ]);
  });

  it('rejeita status fora do enum', async () => {
    expect(await erros({ status: 'quase-la' })).toEqual(['status']);
  });

  it('rejeita version — a versão é do servidor', async () => {
    const dto = plainToInstance(UpdateOnboardingStateDto, { version: 99 });
    expect((dto as Record<string, unknown>).version).toBeUndefined();
  });
});
