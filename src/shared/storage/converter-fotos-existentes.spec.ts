import {
  conversaoSimulada,
  converterFotosExistentes,
  DependenciasConversao,
} from './converter-fotos-existentes';
import { sharp } from './foto-paciente';

describe('converterFotosExistentes', () => {
  let png: Buffer;
  beforeAll(async () => {
    png = await sharp({
      create: { width: 640, height: 480, channels: 3, background: '#808080' },
    })
      .png()
      .toBuffer();
  });

  const deps = (
    over: Partial<Record<keyof DependenciasConversao, jest.Mock>> = {},
  ): Record<keyof DependenciasConversao, jest.Mock> => ({
    baixar: jest.fn(async () => png),
    enviar: jest.fn(
      async (_c: Buffer, nome: string, owner: string) =>
        `patient-photos/${owner}/novo-${nome}`,
    ),
    trocarCaminho: jest.fn(async () => true),
    apagar: jest.fn(async (): Promise<string[]> => []),
    ...over,
  });

  const foto = (id: string, photoPath = `patient-photos/o1/${id}.png`) => ({
    patientId: id,
    ownerId: 'o1',
    photoPath,
  });

  it('converte, troca o caminho e apaga cada original logo após a troca', async () => {
    const d = deps();
    const r = await converterFotosExistentes([foto('p1'), foto('p2')], d);

    expect(r.convertidas).toBe(2);
    expect(r.falhas).toEqual([]);
    expect(d.enviar.mock.calls[0][1]).toMatch(/\.webp$/);
    expect(d.trocarCaminho).toHaveBeenCalledWith(
      'p1',
      'patient-photos/o1/p1.png',
      'patient-photos/o1/novo-p1.webp',
    );
    expect(d.apagar).toHaveBeenCalledTimes(2);
    expect(d.apagar.mock.calls.map((c) => c[0]).sort()).toEqual([
      ['patient-photos/o1/p1.png'],
      ['patient-photos/o1/p2.png'],
    ]);
    const ordemTroca = d.trocarCaminho.mock.invocationCallOrder[0];
    const ordemApaga = d.apagar.mock.invocationCallOrder[0];
    expect(ordemApaga).toBeGreaterThan(ordemTroca);
    expect(r.bytesDepois).toBeLessThan(r.bytesAntes);
  });

  it('original que o bucket não apagou vira falha com o caminho (não conta como convertida)', async () => {
    const d = deps({
      apagar: jest.fn(async (c: string[]) => c),
    });
    const r = await converterFotosExistentes([foto('p1')], d);
    expect(r.convertidas).toBe(0);
    expect(r.falhas).toEqual([
      {
        patientId: 'p1',
        motivo:
          'convertida, mas a original não foi apagada do bucket: patient-photos/o1/p1.png',
      },
    ]);
  });

  it('apagar que lança também vira falha, sem derrubar o lote', async () => {
    const d = deps({
      apagar: jest.fn(async () => {
        throw new Error('R2 fora');
      }),
    });
    const r = await converterFotosExistentes([foto('p1'), foto('p2')], d);
    expect(r.convertidas).toBe(0);
    expect(r.falhas).toHaveLength(2);
  });

  it('UPDATE que falha depois do upload apaga a nova (sem órfã)', async () => {
    const d = deps({
      trocarCaminho: jest.fn(async () => {
        throw new Error('conexão caiu');
      }),
    });
    const r = await converterFotosExistentes([foto('p1')], d);
    expect(r.falhas).toEqual([{ patientId: 'p1', motivo: 'conexão caiu' }]);
    expect(d.apagar).toHaveBeenCalledWith(['patient-photos/o1/novo-p1.webp']);
    expect(d.apagar).not.toHaveBeenCalledWith(['patient-photos/o1/p1.png']);
  });

  it('nome novo não acumula o uuid do upload anterior', async () => {
    const d = deps();
    await converterFotosExistentes(
      [
        foto(
          'p1',
          'patient-photos/o1/3f2b8c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f-maria.png',
        ),
      ],
      d,
    );
    expect(d.enviar.mock.calls[0][1]).toBe('maria.webp');
  });

  it('já em WebP é pulada', async () => {
    const d = deps();
    const r = await converterFotosExistentes(
      [foto('p1', 'patient-photos/o1/x.webp')],
      d,
    );
    expect(r).toMatchObject({ convertidas: 0, jaOtimizadas: 1 });
    expect(d.baixar).not.toHaveBeenCalled();
  });

  it('se a foto foi trocada no meio, apaga a nova e mantém a atual', async () => {
    const d = deps({ trocarCaminho: jest.fn(async () => false) });
    const r = await converterFotosExistentes([foto('p1')], d);
    expect(r.convertidas).toBe(0);
    expect(r.falhas[0].motivo).toContain('trocada');
    expect(d.apagar).toHaveBeenCalledWith(['patient-photos/o1/novo-p1.webp']);
  });

  it('falha em uma não derruba as outras; arquivo sumido vira falha', async () => {
    const d = deps({
      baixar: jest.fn(async (c: string) => (c.includes('p1') ? null : png)),
    });
    const r = await converterFotosExistentes([foto('p1'), foto('p2')], d);
    expect(r.convertidas).toBe(1);
    expect(r.falhas).toEqual([
      { patientId: 'p1', motivo: 'arquivo não encontrado no bucket' },
    ]);
  });

  it('simular só mede: nada sobe, troca ou apaga', async () => {
    const d = deps();
    const r = await converterFotosExistentes([foto('p1')], d, true);
    expect(r.convertidas).toBe(1);
    expect(r.bytesAntes).toBeGreaterThan(0);
    expect(d.enviar).not.toHaveBeenCalled();
    expect(d.trocarCaminho).not.toHaveBeenCalled();
    expect(d.apagar).not.toHaveBeenCalled();
  });

  describe('conversaoSimulada (argumentos do script)', () => {
    it('sem flag nenhuma é simulação', () => {
      expect(conversaoSimulada(['--owner-email', 'a@b.com'])).toBe(true);
    });
    it('--simular continua simulação', () => {
      expect(conversaoSimulada(['--owner-email', 'a@b.com', '--simular'])).toBe(
        true,
      );
    });
    it('typo não vira destrutivo', () => {
      expect(conversaoSimulada(['--aplica', '--apply'])).toBe(true);
    });
    it('só --aplicar grava', () => {
      expect(conversaoSimulada(['--owner-email', 'a@b.com', '--aplicar'])).toBe(
        false,
      );
    });
  });
});
