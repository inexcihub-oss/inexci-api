import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { emptyOnboardingState } from '../onboarding.constants';
import { UpdateOnboardingStateDto } from './update-onboarding-state.dto';

/**
 * Espelha a configuração real do `ValidationPipe` global
 * (`whitelist` + `forbidNonWhitelisted`). Com apenas `whitelist`, apagar um
 * decorator de validação faria o campo ser silenciosamente descartado em vez
 * de validado — e o teste do caminho feliz continuaria passando, mascarando a
 * regressão.
 */
async function erros(payload: Record<string, unknown>) {
  const dto = plainToInstance(UpdateOnboardingStateDto, payload);
  const resultado = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
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

  it('aceita a trilha e o passo do dashboard', async () => {
    expect(
      await erros({
        completedSteps: { 'ver-dashboard': '2026-08-24T14:09:40.000Z' },
        toursSeen: { dashboard: '2026-08-24T14:09:40.000Z' },
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
      await erros({
        toursSeen: { trilha_inventada: '2026-08-21T14:00:00.000Z' },
      }),
    ).toEqual(['toursSeen']);
  });

  it('rejeita valor que não é timestamp', async () => {
    expect(
      await erros({ completedSteps: { 'criar-solicitacao': 'ontem' } }),
    ).toEqual(['completedSteps']);
  });

  it('rejeita data parseável que não é ISO-8601', async () => {
    expect(
      await erros({
        completedSteps: { 'criar-solicitacao': 'August 21, 2026' },
      }),
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

  /**
   * Achado CRITICAL da revisão final: o frontend manda o `OnboardingState`
   * inteiro menos `version` (`OnboardingProvider.tsx`:
   * `const { version: _version, ...patch } = paraEnviar`), o que inclui
   * `restartedAt` — campo que o DTO não declarava. Resultado em produção:
   * todo `PATCH /onboarding/state` do cliente real tomava 400 e o onboarding
   * nunca persistia, com as duas suítes verdes, porque nenhum teste montava
   * o payload a partir do shape real do GET.
   *
   * Este teste monta esse payload real — `emptyOnboardingState()` menos
   * `version` — para não poder divergir do shape verdadeiro, e exige ZERO
   * erros. Sem os dois `@Exclude()` (`version` e `restartedAt`), essas duas
   * chaves sobram como propriedade própria da instância e
   * `forbidNonWhitelisted` rejeita a requisição.
   */
  it('aceita o OnboardingState completo devolvido pelo GET, menos version', async () => {
    const { version: _version, ...estadoCompleto } = emptyOnboardingState();

    expect(await erros(estadoCompleto)).toEqual([]);
  });
});
