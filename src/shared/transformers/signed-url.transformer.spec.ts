import { StorageService } from 'src/shared/storage/storage.service';
import { transformDoctorSignatureUrl } from './signed-url.transformer';

function storage() {
  return {
    nomeDoBucket: 'inexci',
    getSignedUrl: jest.fn((p: string) => Promise.resolve(`https://r2/${p}`)),
  };
}

function medico(logoUrl: string | null) {
  return {
    id: 'd1',
    ownerId: 'o1',
    doctorProfile: { signatureUrl: null, header: { logoUrl } },
  };
}

describe('transformDoctorSignatureUrl — logo do cabeçalho', () => {
  it('assina o logo da pasta de cabeçalhos da conta', async () => {
    const s = storage();
    const r = await transformDoctorSignatureUrl(
      medico('headers/o1/a.png'),
      s as unknown as StorageService,
    );
    expect(r.doctorProfile?.header?.logoUrl).toBe(
      'https://r2/headers/o1/a.png',
    );
  });

  it('não assina logo de outra conta', async () => {
    const s = storage();
    const r = await transformDoctorSignatureUrl(
      medico('headers/o2/a.png'),
      s as unknown as StorageService,
    );
    expect(r.doctorProfile?.header?.logoUrl).toBeNull();
    expect(s.getSignedUrl).not.toHaveBeenCalled();
  });

  it('descarta URL externa', async () => {
    const s = storage();
    const r = await transformDoctorSignatureUrl(
      medico('https://evil.example.com/x.png'),
      s as unknown as StorageService,
    );
    expect(r.doctorProfile?.header?.logoUrl).toBeNull();
  });
});
