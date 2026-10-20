const detectarTipo = (buf: Buffer) => {
  const hex = buf.subarray(0, 8).toString('hex');
  if (hex.startsWith('89504e470d0a1a0a'))
    return Promise.resolve({ ext: 'png', mime: 'image/png' });
  if (hex.startsWith('ffd8ff'))
    return Promise.resolve({ ext: 'jpg', mime: 'image/jpeg' });
  if (buf.subarray(0, 4).toString() === '%PDF')
    return Promise.resolve({ ext: 'pdf', mime: 'application/pdf' });
  return Promise.resolve(undefined);
};
jest.mock('file-type', () => ({ fileTypeFromBuffer: detectarTipo }), {
  virtual: true,
});

import {
  ArquivoRecebidoInvalidoError,
  MIME_DOCUMENTOS_RECEBIDOS,
  MIME_IMAGENS_RECEBIDAS,
  garantirExtensao,
  tiparArquivoRecebido,
} from './arquivo-recebido';

const PNG = Buffer.from('89504e470d0a1a0a0000', 'hex');
const JPG = Buffer.from('ffd8ffe000104a46', 'hex');
const PDF = Buffer.from('%PDF-1.7 conteudo');
const LIXO = Buffer.from('nada de mais');

describe('garantirExtensao', () => {
  it('acrescenta a extensão a um nome sem extensão', () => {
    expect(garantirExtensao('Imagem do laudo 10/10/2026', 'jpg')).toBe(
      'Imagem do laudo 10/10/2026.jpg',
    );
  });

  it('troca uma extensão conhecida divergente', () => {
    expect(garantirExtensao('foto.png', 'jpg')).toBe('foto.jpg');
    expect(garantirExtensao('foto.JPEG', 'jpg')).toBe('foto.jpg');
  });

  it('preserva pontos que não são extensão', () => {
    expect(garantirExtensao('laudo v1.2', 'pdf')).toBe('laudo v1.2.pdf');
  });

  it('usa nome padrão quando vazio', () => {
    expect(garantirExtensao('', 'png')).toBe('arquivo.png');
  });
});

describe('tiparArquivoRecebido', () => {
  it('usa o tipo detectado pelo conteúdo, não o declarado', async () => {
    await expect(
      tiparArquivoRecebido(JPG, 'Imagem_do_laudo', MIME_IMAGENS_RECEBIDAS),
    ).resolves.toEqual({
      mime: 'image/jpeg',
      ext: 'jpg',
      nome: 'Imagem_do_laudo.jpg',
    });
    await expect(
      tiparArquivoRecebido(PNG, 'x.jpg', MIME_IMAGENS_RECEBIDAS),
    ).resolves.toMatchObject({ mime: 'image/png', nome: 'x.png' });
  });

  it('aceita PDF quando permitido', async () => {
    await expect(
      tiparArquivoRecebido(PDF, 'doc', MIME_DOCUMENTOS_RECEBIDOS),
    ).resolves.toMatchObject({ mime: 'application/pdf', nome: 'doc.pdf' });
  });

  it('recusa PDF onde só imagem é permitida', async () => {
    await expect(
      tiparArquivoRecebido(PDF, 'doc', MIME_IMAGENS_RECEBIDAS),
    ).rejects.toBeInstanceOf(ArquivoRecebidoInvalidoError);
  });

  it('recusa conteúdo não reconhecido', async () => {
    await expect(
      tiparArquivoRecebido(LIXO, 'doc', MIME_DOCUMENTOS_RECEBIDOS),
    ).rejects.toBeInstanceOf(ArquivoRecebidoInvalidoError);
  });
});
