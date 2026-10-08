import {
  ehArquivoDaConta,
  PASTAS_DE_ASSINATURA,
  PASTAS_DE_AVATAR,
} from './arquivo-da-conta';

describe('ehArquivoDaConta', () => {
  const OWNER = 'dono-1';

  it.each([
    ['avatar da conta', `avatars/${OWNER}/uuid-foto.png`, PASTAS_DE_AVATAR],
    [
      'assinatura da conta',
      `signatures/${OWNER}/uuid-ass.png`,
      PASTAS_DE_ASSINATURA,
    ],
    ['carimbo da conta', `stamps/${OWNER}/uuid-car.png`, PASTAS_DE_ASSINATURA],
  ])('aceita %s', (_rotulo, caminho, pastas) => {
    expect(ehArquivoDaConta(caminho, pastas, OWNER)).toBe(true);
  });

  it.each([
    ['foto de paciente', `patient-photos/${OWNER}/uuid-foto.webp`],
    ['documento', `documents/${OWNER}/laudo.pdf`],
    ['avatar de outra conta', 'avatars/outro-dono/uuid-foto.png'],
    ['avatar legado sem conta', 'avatars/uuid-foto.png'],
    ['subpasta', `avatars/${OWNER}/x/foto.png`],
    ['travessia', `avatars/${OWNER}/../../patient-photos/${OWNER}/f.webp`],
    ['barra invertida', `avatars/${OWNER}/..\\f.png`],
    ['só o prefixo', `avatars/${OWNER}/`],
    ['URL', 'https://exemplo.com/foto.png'],
    ['vazio', ''],
  ])('recusa %s como avatar', (_rotulo, caminho) => {
    expect(ehArquivoDaConta(caminho, PASTAS_DE_AVATAR, OWNER)).toBe(false);
  });

  it('sem ownerId não há pasta da conta para conferir', () => {
    expect(
      ehArquivoDaConta(`avatars/${OWNER}/f.png`, PASTAS_DE_AVATAR, null),
    ).toBe(false);
  });

  it('assinatura não vale como avatar, nem o contrário', () => {
    expect(
      ehArquivoDaConta(`signatures/${OWNER}/a.png`, PASTAS_DE_AVATAR, OWNER),
    ).toBe(false);
    expect(
      ehArquivoDaConta(`avatars/${OWNER}/a.png`, PASTAS_DE_ASSINATURA, OWNER),
    ).toBe(false);
  });
});
