import { Test } from '@nestjs/testing';
import { UserRepository } from 'src/database/repositories/user.repository';
import { DoctorHeaderRepository } from 'src/database/repositories/doctor-header.repository';
import { StorageService } from 'src/shared/storage/storage.service';
import { DoctorPdfContextService } from './doctor-pdf-context.service';

describe('DoctorPdfContextService', () => {
  let service: DoctorPdfContextService;
  let userRepository: { findOneWithProfile: jest.Mock };
  let doctorHeaderRepository: { findByDoctorProfileId: jest.Mock };
  let storageService: { getSignedUrl: jest.Mock };

  const doctorWithProfile = {
    id: 'doctor-1',
    name: 'Dra. Ana Souza',
    email: 'ana@clinica.com',
    phone: '21999998888',
    doctorProfile: {
      id: 'profile-1',
      crm: '12345',
      crmState: 'RJ',
      specialty: 'Ortopedia',
      signatureUrl: 'signatures/ana.png',
    },
  };

  beforeEach(async () => {
    userRepository = { findOneWithProfile: jest.fn() };
    doctorHeaderRepository = { findByDoctorProfileId: jest.fn() };
    storageService = { getSignedUrl: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        DoctorPdfContextService,
        { provide: UserRepository, useValue: userRepository },
        { provide: DoctorHeaderRepository, useValue: doctorHeaderRepository },
        { provide: StorageService, useValue: storageService },
      ],
    }).compile();

    service = module.get(DoctorPdfContextService);
  });

  it('monta o CRM com o estado e assina a URL da assinatura', async () => {
    userRepository.findOneWithProfile.mockResolvedValue(doctorWithProfile);
    doctorHeaderRepository.findByDoctorProfileId.mockResolvedValue(null);
    storageService.getSignedUrl.mockResolvedValue(
      'https://r2/ana-assinada.png',
    );

    const context = await service.buildForDoctorId('doctor-1');

    expect(context.doctor.name).toBe('Dra. Ana Souza');
    expect(context.doctorCrm).toBe('CRM 12345/RJ');
    expect(context.doctorSignatureUrl).toBe('https://r2/ana-assinada.png');
    expect(storageService.getSignedUrl).toHaveBeenCalledWith(
      'signatures/ana.png',
    );
  });

  it('omite o estado quando o perfil não tem crmState', async () => {
    userRepository.findOneWithProfile.mockResolvedValue({
      ...doctorWithProfile,
      doctorProfile: { id: 'profile-1', crm: '999', signatureUrl: null },
    });
    doctorHeaderRepository.findByDoctorProfileId.mockResolvedValue(null);

    const context = await service.buildForDoctorId('doctor-1');

    expect(context.doctorCrm).toBe('CRM 999');
    expect(context.doctorSignatureUrl).toBeUndefined();
  });

  it('não quebra o PDF quando a assinatura falha ao ser assinada', async () => {
    userRepository.findOneWithProfile.mockResolvedValue(doctorWithProfile);
    doctorHeaderRepository.findByDoctorProfileId.mockResolvedValue(null);
    storageService.getSignedUrl.mockRejectedValue(new Error('R2 fora do ar'));

    const context = await service.buildForDoctorId('doctor-1');

    expect(context.doctorSignatureUrl).toBeUndefined();
    expect(context.doctor.name).toBe('Dra. Ana Souza');
  });

  it('usa a assinatura direto quando já é uma URL absoluta', async () => {
    userRepository.findOneWithProfile.mockResolvedValue({
      ...doctorWithProfile,
      doctorProfile: {
        ...doctorWithProfile.doctorProfile,
        signatureUrl: 'https://cdn.externo/ana.png',
      },
    });
    doctorHeaderRepository.findByDoctorProfileId.mockResolvedValue(null);

    const context = await service.buildForDoctorId('doctor-1');

    expect(context.doctorSignatureUrl).toBe('https://cdn.externo/ana.png');
    expect(storageService.getSignedUrl).not.toHaveBeenCalled();
  });

  it('resolve o cabeçalho customizado do médico com o logo assinado', async () => {
    userRepository.findOneWithProfile.mockResolvedValue(doctorWithProfile);
    doctorHeaderRepository.findByDoctorProfileId.mockResolvedValue({
      logoUrl: 'headers/logo.png',
      logoPosition: 'center',
      contentHtml: '<p>Clínica Souza</p>',
    });
    storageService.getSignedUrl.mockImplementation((path: string) =>
      Promise.resolve(`https://r2/${path}`),
    );

    const context = await service.buildForDoctorId('doctor-1');

    expect(context.customHeader).toEqual({
      logoUrl: 'https://r2/headers/logo.png',
      logoPosition: 'center',
      contentHtml: '<p>Clínica Souza</p>',
    });
  });

  it('devolve customHeader nulo quando o médico não configurou cabeçalho', async () => {
    userRepository.findOneWithProfile.mockResolvedValue(doctorWithProfile);
    doctorHeaderRepository.findByDoctorProfileId.mockResolvedValue(null);

    const context = await service.buildForDoctorId('doctor-1');

    expect(context.customHeader).toBeNull();
  });

  it('lança quando o médico não existe', async () => {
    userRepository.findOneWithProfile.mockResolvedValue(null);

    await expect(service.buildForDoctorId('sumido')).rejects.toThrow(
      'Médico não encontrado para geração de PDF: sumido',
    );
  });
});
