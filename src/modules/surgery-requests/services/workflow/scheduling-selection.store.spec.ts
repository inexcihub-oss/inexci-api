import { SchedulingSelectionStore } from './scheduling-selection.store';
import { PhoneNormalizerService } from 'src/shared/ai/services/orchestrator/phone-normalizer.service';

describe('SchedulingSelectionStore', () => {
  const phoneNormalizer = new PhoneNormalizerService({} as never);

  function buildStore(redis: unknown) {
    const store = new SchedulingSelectionStore(
      { get: jest.fn() } as never,
      phoneNormalizer,
    );
    (store as unknown as { redis: unknown }).redis = redis;
    return store;
  }

  it('grava o marcador em todas as variantes do telefone (com e sem o 9)', async () => {
    const set = jest.fn();
    const pipeline = { set, exec: jest.fn().mockResolvedValue([]) };
    const store = buildStore({
      status: 'ready',
      pipeline: () => pipeline,
    });

    await store.remember('(11) 99887-7665', 'sc-1');

    const keys = set.mock.calls.map(([key]) => key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'sc:scheduling-selection:11998877665',
        'sc:scheduling-selection:1198877665',
      ]),
    );
    expect(set.mock.calls[0]).toEqual([
      expect.any(String),
      'sc-1',
      'EX',
      expect.any(Number),
    ]);
  });

  it('acha o marcador pelo remetente do Twilio (whatsapp:+55…)', async () => {
    const mget = jest.fn().mockResolvedValue([null, 'sc-1']);
    const store = buildStore({ status: 'ready', mget });

    await expect(store.find('whatsapp:+5511998877665')).resolves.toBe('sc-1');
    expect(mget).toHaveBeenCalledWith(
      expect.stringContaining('11998877665'),
      expect.any(String),
    );
  });

  it('fail-open: sem Redis pronto não grava e devolve null', async () => {
    const store = buildStore({ status: 'connecting' });

    await expect(
      store.remember('11998877665', 'sc-1'),
    ).resolves.toBeUndefined();
    await expect(store.find('11998877665')).resolves.toBeNull();
  });

  it('fail-open: erro do Redis na leitura vira null', async () => {
    const store = buildStore({
      status: 'ready',
      mget: jest.fn().mockRejectedValue(new Error('down')),
    });

    await expect(store.find('11998877665')).resolves.toBeNull();
  });
});
