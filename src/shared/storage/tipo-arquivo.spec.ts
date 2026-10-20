import { BadRequestException } from '@nestjs/common';

const detectarTipo = (buf: Buffer) => {
  const hex = buf.subarray(0, 8).toString('hex');
  const inicio = buf.subarray(0, 4).toString();
  if (hex.startsWith('89504e470d0a1a0a'))
    return Promise.resolve({ ext: 'png', mime: 'image/png' });
  if (hex.startsWith('ffd8ff'))
    return Promise.resolve({ ext: 'jpg', mime: 'image/jpeg' });
  if (inicio === '%PDF')
    return Promise.resolve({ ext: 'pdf', mime: 'application/pdf' });
  if (hex.startsWith('d0cf11e0a1b11ae1'))
    return Promise.resolve({ ext: 'cfb', mime: 'application/x-cfb' });
  if (inicio === 'DOCX')
    return Promise.resolve({
      ext: 'docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  return Promise.resolve(undefined);
};
jest.mock('file-type', () => ({ fileTypeFromBuffer: detectarTipo }), {
  virtual: true,
});

import {
  MIME_DOC,
  MIME_DOCX,
  MIME_DOCUMENTOS_PERMITIDOS,
  PASTAS_DE_DOCUMENTO,
  cabecalhosDeRespostaPorCaminho,
  contentTypeSeguro,
  nomeComExtensao,
  prepararDocumentoParaUpload,
  validarTipoArquivo,
} from './tipo-arquivo';

const PDF = Buffer.from('%PDF-1.7 conteudo');
const PNG = Buffer.from('89504e470d0a1a0a0000', 'hex');
const DOC = Buffer.from('d0cf11e0a1b11ae10000', 'hex');
const DOCX = Buffer.from('DOCX conteudo');
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

const arquivo = (originalname: string, mimetype: string, buffer: Buffer) => ({
  originalname,
  mimetype,
  buffer,
});

describe('tipo-arquivo', () => {
  describe('allowlist de documentos', () => {
    it('aceita PDF, JPEG, PNG, WEBP, DOC e DOCX e nada de HTML/SVG/JS', () => {
      expect([...MIME_DOCUMENTOS_PERMITIDOS].sort()).toEqual(
        [
          'application/pdf',
          'image/jpeg',
          'image/png',
          'image/webp',
          MIME_DOC,
          MIME_DOCX,
        ].sort(),
      );
      for (const proibido of [
        'text/html',
        'image/svg+xml',
        'application/javascript',
        'text/javascript',
      ]) {
        expect(MIME_DOCUMENTOS_PERMITIDOS).not.toContain(proibido);
      }
    });

    it('pastas de documento são só documents, post-surgical e report', () => {
      expect([...PASTAS_DE_DOCUMENTO]).toEqual([
        'documents',
        'post-surgical',
        'report',
      ]);
    });
  });

  describe('validarTipoArquivo', () => {
    it('aceita PDF real e devolve o tipo detectado', async () => {
      await expect(
        validarTipoArquivo(
          arquivo('a.pdf', 'application/pdf', PDF),
          MIME_DOCUMENTOS_PERMITIDOS,
        ),
      ).resolves.toEqual({ mime: 'application/pdf', ext: 'pdf' });
    });

    it('recusa HTML declarado como text/html', async () => {
      await expect(
        validarTipoArquivo(
          arquivo('x.html', 'text/html', HTML),
          MIME_DOCUMENTOS_PERMITIDOS,
        ),
      ).rejects.toThrow('Tipo de arquivo não permitido: text/html');
    });

    it('recusa SVG declarado como image/svg+xml', async () => {
      await expect(
        validarTipoArquivo(
          arquivo('x.svg', 'image/svg+xml', Buffer.from('<svg/>')),
          MIME_DOCUMENTOS_PERMITIDOS,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa HTML disfarçado de PDF (magic bytes não batem)', async () => {
      await expect(
        validarTipoArquivo(
          arquivo('x.pdf', 'application/pdf', HTML),
          MIME_DOCUMENTOS_PERMITIDOS,
        ),
      ).rejects.toThrow('Tipo de arquivo inválido');
    });

    it('recusa PNG declarado como PDF', async () => {
      await expect(
        validarTipoArquivo(
          arquivo('x.pdf', 'application/pdf', PNG),
          MIME_DOCUMENTOS_PERMITIDOS,
        ),
      ).rejects.toThrow('Tipo de arquivo inválido');
    });

    it('aceita DOC (contêiner CFB) e DOCX', async () => {
      await expect(
        validarTipoArquivo(
          arquivo('a.doc', MIME_DOC, DOC),
          MIME_DOCUMENTOS_PERMITIDOS,
        ),
      ).resolves.toEqual({ mime: MIME_DOC, ext: 'doc' });
      await expect(
        validarTipoArquivo(
          arquivo('a.docx', MIME_DOCX, DOCX),
          MIME_DOCUMENTOS_PERMITIDOS,
        ),
      ).resolves.toEqual({ mime: MIME_DOCX, ext: 'docx' });
    });

    it('mime genérico (octet-stream) usa o tipo detectado se estiver na allowlist', async () => {
      await expect(
        validarTipoArquivo(
          arquivo('a', 'application/octet-stream', PDF),
          MIME_DOCUMENTOS_PERMITIDOS,
        ),
      ).resolves.toEqual({ mime: 'application/pdf', ext: 'pdf' });
      await expect(
        validarTipoArquivo(arquivo('a', '', DOC), MIME_DOCUMENTOS_PERMITIDOS),
      ).resolves.toEqual({ mime: MIME_DOC, ext: 'doc' });
    });

    it('mime genérico sem assinatura reconhecível é recusado', async () => {
      await expect(
        validarTipoArquivo(
          arquivo('x', 'application/octet-stream', HTML),
          MIME_DOCUMENTOS_PERMITIDOS,
        ),
      ).rejects.toThrow('Tipo de arquivo inválido');
    });

    it('image/jpg é tratado como image/jpeg', async () => {
      await expect(
        validarTipoArquivo(
          arquivo('a.jpg', 'image/jpg', Buffer.from('ffd8ffe0', 'hex')),
          MIME_DOCUMENTOS_PERMITIDOS,
        ),
      ).resolves.toEqual({ mime: 'image/jpeg', ext: 'jpg' });
    });

    it('sem detecção, só passa quando exigeDeteccao libera o tipo', async () => {
      await expect(
        validarTipoArquivo(
          arquivo('a.mp3', 'audio/mpeg', Buffer.from('xx')),
          ['audio/mpeg'],
          { exigeDeteccao: () => false },
        ),
      ).resolves.toEqual({ mime: 'audio/mpeg', ext: 'mp3' });
      await expect(
        validarTipoArquivo(arquivo('a.mp3', 'audio/mpeg', Buffer.from('xx')), [
          'audio/mpeg',
        ]),
      ).rejects.toThrow('Tipo de arquivo inválido');
    });
  });

  describe('prepararDocumentoParaUpload', () => {
    it('grava o tipo detectado e corrige a extensão do nome', async () => {
      const preparado = await prepararDocumentoParaUpload(
        arquivo('exame.html', 'application/octet-stream', PDF),
      );
      expect(preparado.mimetype).toBe('application/pdf');
      expect(preparado.originalname).toBe('exame.pdf');
    });
  });

  describe('nomeComExtensao', () => {
    it('troca, acrescenta ou mantém a extensão', () => {
      expect(nomeComExtensao('laudo.PDF', 'pdf')).toBe('laudo.pdf');
      expect(nomeComExtensao('laudo', 'pdf')).toBe('laudo.pdf');
      expect(nomeComExtensao('laudo.svg', undefined)).toBe('laudo.svg');
      expect(nomeComExtensao('', 'png')).toBe('arquivo.png');
    });
  });

  describe('contentTypeSeguro', () => {
    it('mantém tipos seguros e rebaixa o resto para octet-stream', () => {
      expect(contentTypeSeguro('application/pdf')).toBe('application/pdf');
      expect(contentTypeSeguro('image/jpg')).toBe('image/jpeg');
      expect(contentTypeSeguro('audio/ogg; codecs=opus')).toBe('audio/ogg');
      expect(contentTypeSeguro('text/html')).toBe('application/octet-stream');
      expect(contentTypeSeguro('image/svg+xml')).toBe(
        'application/octet-stream',
      );
      expect(contentTypeSeguro(undefined)).toBe('application/octet-stream');
    });
  });

  describe('cabecalhosDeRespostaPorCaminho', () => {
    it('PDF e imagem continuam inline, com tipo fixado pela extensão', () => {
      expect(cabecalhosDeRespostaPorCaminho('documents/o/u-laudo.pdf')).toEqual(
        { ResponseContentType: 'application/pdf' },
      );
      expect(
        cabecalhosDeRespostaPorCaminho('patient-photos/o/foto.webp'),
      ).toEqual({ ResponseContentType: 'image/webp' });
      expect(cabecalhosDeRespostaPorCaminho('signatures/o/a.JPG')).toEqual({
        ResponseContentType: 'image/jpeg',
      });
    });

    it('DOCX vira download com o tipo certo', () => {
      expect(
        cabecalhosDeRespostaPorCaminho('documents/o/u-receita.docx'),
      ).toEqual({
        ResponseContentType: MIME_DOCX,
        ResponseContentDisposition: 'attachment; filename="u-receita.docx"',
      });
    });

    it('HTML/SVG legados viram download como octet-stream', () => {
      expect(cabecalhosDeRespostaPorCaminho('documents/o/x.html')).toEqual({
        ResponseContentType: 'application/octet-stream',
        ResponseContentDisposition: 'attachment; filename="x.html"',
      });
      expect(
        cabecalhosDeRespostaPorCaminho('documents/o/x.svg').ResponseContentType,
      ).toBe('application/octet-stream');
    });

    it('sem extensão: força download e não reescreve o tipo', () => {
      expect(
        cabecalhosDeRespostaPorCaminho('documents/o/sem_extensao'),
      ).toEqual({
        ResponseContentDisposition: 'attachment; filename="sem_extensao"',
      });
    });

    it('nome com aspas ou quebra de linha não injeta cabeçalho', () => {
      const { ResponseContentDisposition } = cabecalhosDeRespostaPorCaminho(
        'documents/o/a"\r\nX: y.txt',
      );
      expect(ResponseContentDisposition).toBe(
        'attachment; filename="a___X__y.txt"',
      );
    });
  });
});
