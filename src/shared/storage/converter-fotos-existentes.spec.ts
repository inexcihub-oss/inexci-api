import {
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
    apagar: jest.fn(async () => undefined),
    ...over,
  });

  const foto = (id: string, photoPath = `patient-photos/o1/${id}.png`) => ({
    patientId: id,
    ownerId: 'o1',
    photoPath,
  });

  it('converte, troca o caminho e só então apaga as originais', async () => {
    const d = deps();
    const r = await converterFotosExistentes([foto('p1'), foto('p2')], d);

    expect(r.convertidas).toBe(2);
    expect(d.enviar.mock.calls[0][1]).toMatch(/\.webp$/);
    expect(d.trocarCaminho).toHaveBeenCalledWith(
      'p1',
      'patient-photos/o1/p1.png',
      'patient-photos/o1/novo-p1.webp',
    );
    expect(d.apagar).toHaveBeenCalledTimes(1);
    expect(d.apagar.mock.calls[0][0].sort()).toEqual([
      'patient-photos/o1/p1.png',
      'patient-photos/o1/p2.png',
    ]);
    expect(r.bytesDepois).toBeLessThan(r.bytesAntes);
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
});
