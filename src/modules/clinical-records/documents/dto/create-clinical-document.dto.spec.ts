import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateClinicalDocumentDto } from './create-clinical-document.dto';

const base = {
  patientId: '7d0c5d0e-6a0f-4c4c-9a5b-1f2d3c4b5a69',
  key: 'exam',
  name: 'Exame',
  folder: 'documents',
};

async function erros(dados: Record<string, unknown>) {
  const dto = plainToInstance(CreateClinicalDocumentDto, dados);
  return (await validate(dto)).map((e) => e.property);
}

describe('CreateClinicalDocumentDto', () => {
  it.each(['documents', 'post-surgical', 'report'])(
    'aceita a pasta de documento %s',
    async (folder) => {
      expect(await erros({ ...base, folder })).toEqual([]);
    },
  );

  it.each(['avatars', 'headers', 'signatures', 'patient-photos', 'pdfs'])(
    'recusa a pasta %s',
    async (folder) => {
      expect(await erros({ ...base, folder })).toContain('folder');
    },
  );

  it.each(['prescription', 'medical_certificate', 'exam_referral'])(
    'recusa key/type reservados a documento emitido (%s)',
    async (reservado) => {
      expect(await erros({ ...base, key: reservado })).toContain('key');
      expect(await erros({ ...base, type: reservado })).toContain('type');
    },
  );
});
