import { readFileSync } from 'fs';
import { join } from 'path';
import { limitesDeUpload } from './limites-upload';

describe('limitesDeUpload', () => {
  it('limita tamanho, quantidade de arquivos, campos e partes', () => {
    expect(limitesDeUpload(1024)).toEqual({
      limits: {
        fileSize: 1024,
        files: 1,
        fields: 20,
        fieldSize: 64 * 1024,
        parts: 21,
      },
    });
    expect(limitesDeUpload(2048, 5).limits).toMatchObject({
      fileSize: 2048,
      files: 5,
      parts: 25,
    });
  });

  it.each([
    'modules/upload/upload.controller.ts',
    'modules/surgery-requests/documents/documents.controller.ts',
    'modules/clinical-records/documents/clinical-documents.controller.ts',
    'modules/surgery-requests/surgery-requests.controller.ts',
  ])('%s usa limitesDeUpload em todo interceptor de arquivo', (arquivo) => {
    const fonte = readFileSync(join(__dirname, '..', '..', arquivo), 'utf8');
    const interceptores = fonte.match(/Files?Interceptor\(/g) ?? [];
    const comLimite = fonte.match(/Files?Interceptor\([^)]*limitesDeUpload/gs);
    expect(interceptores.length).toBeGreaterThan(0);
    expect(comLimite?.length).toBe(interceptores.length);
  });
});
