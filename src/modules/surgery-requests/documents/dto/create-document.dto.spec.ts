import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateDocumentDto } from './create-document.dto';

const base = {
  surgeryRequestId: '7d0c5d0e-6a0f-4c4c-9a5b-1f2d3c4b5a69',
  key: 'exam',
  name: 'Exame',
};

async function erros(folder: string) {
  const dto = plainToInstance(CreateDocumentDto, { ...base, folder });
  return (await validate(dto)).map((e) => e.property);
}

describe('CreateDocumentDto', () => {
  it.each(['documents', 'post-surgical', 'report'])(
    'aceita a pasta de documento %s',
    async (folder) => {
      expect(await erros(folder)).toEqual([]);
    },
  );

  it.each(['avatars', 'headers', 'signatures', 'stamps', 'whatsapp-tmp'])(
    'recusa a pasta %s',
    async (folder) => {
      expect(await erros(folder)).toContain('folder');
    },
  );
});
