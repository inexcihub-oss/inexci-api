import { BadRequestException } from '@nestjs/common';
import { PatientsService } from './patients.service';
import { PatientRepository } from 'src/database/repositories/patient.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { MailService } from 'src/shared/mail/mail.service';
import { StorageService } from 'src/shared/storage/storage.service';
import { Patient } from 'src/database/entities/patient.entity';

jest.mock('src/shared/logging/audit', () => ({
  auditProntuarioAccess: jest.fn(),
}));

const OWNER = 'owner-a';
const FOTO = `patient-photos/${OWNER}/uuid-foto.png`;

function paciente(parcial: Partial<Patient> = {}): Patient {
  return {
    id: 'pac-1',
    ownerId: OWNER,
    doctorId: OWNER,
    name: 'Maria',
    cpf: '12345678909',
    phone: null,
    secondaryPhone: null,
    photoPath: null,
    ...parcial,
  } as Patient;
}

describe('PatientsService', () => {
  let service: PatientsService;
  let patientRepository: {
    create: jest.Mock;
    update: jest.Mock;
    findOne: jest.Mock;
    findAndCountWithSearch: jest.Mock;
    getRepository: jest.Mock;
  };
  /** Pacientes (fora o editado) que já apontam para o caminho consultado. */
  let contagemDeUso: jest.Mock;
  /** Linha lida com FOR UPDATE dentro da transação da troca de foto. */
  let lidoNaTransacao: jest.Mock;
  let transaction: jest.Mock;
  let storageService: { getSignedUrl: jest.Mock; delete: jest.Mock };

  beforeEach(() => {
    patientRepository = {
      create: jest.fn((dados) => Promise.resolve(paciente(dados))),
      update: jest.fn((id, dados) =>
        Promise.resolve(paciente({ id, ...dados })),
      ),
      findOne: jest.fn().mockResolvedValue(paciente()),
      findAndCountWithSearch: jest.fn(),
      getRepository: jest.fn(),
    };
    contagemDeUso = jest.fn().mockResolvedValue(0);
    // Por padrão a linha travada é a mesma lida no início do update.
    lidoNaTransacao = jest.fn(() => patientRepository.findOne());
    transaction = jest.fn(
      (cb: (em: { getRepository: () => unknown }) => unknown) =>
        cb({
          getRepository: () => ({
            findOne: lidoNaTransacao,
            update: patientRepository.update,
          }),
        }),
    );
    patientRepository.getRepository.mockReturnValue({
      count: contagemDeUso,
      manager: { transaction },
    });
    storageService = {
      getSignedUrl: jest.fn((p: string) => Promise.resolve(`https://r2/${p}`)),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const userRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'user-1', ownerId: OWNER }),
    };
    const accessControlService = {
      assertSameOwner: jest.fn().mockResolvedValue(undefined),
      getOwnerId: jest.fn().mockResolvedValue(OWNER),
    };

    service = new PatientsService(
      patientRepository as unknown as PatientRepository,
      userRepository as unknown as UserRepository,
      { sendPatientWelcome: jest.fn() } as unknown as WhatsappService,
      accessControlService as unknown as AccessControlService,
      { sendWelcomePatient: jest.fn() } as unknown as MailService,
      storageService as unknown as StorageService,
    );
  });

  const gravadoNoCreate = () => patientRepository.create.mock.calls[0][0];
  const gravadoNoUpdate = () => patientRepository.update.mock.calls[0][1];

  describe('CPF opcional', () => {
    it('cria paciente sem CPF gravando null', async () => {
      await service.create({ name: 'Maria' }, 'user-1');

      expect(gravadoNoCreate().cpf).toBeNull();
    });

    it('CPF só com espaços vira null, nunca string vazia', async () => {
      await service.create({ name: 'Maria', cpf: '   ' }, 'user-1');

      expect(gravadoNoCreate().cpf).toBeNull();
    });

    it('mantém o CPF informado', async () => {
      await service.create({ name: 'Maria', cpf: ' 12345678909 ' }, 'user-1');

      expect(gravadoNoCreate().cpf).toBe('12345678909');
    });

    it('apagar o CPF no update grava null', async () => {
      await service.update('pac-1', { cpf: '' }, 'user-1');

      expect(gravadoNoUpdate().cpf).toBeNull();
    });

    it('update sem o campo cpf não mexe no CPF', async () => {
      await service.update('pac-1', { name: 'Maria Silva' }, 'user-1');

      expect(gravadoNoUpdate()).not.toHaveProperty('cpf');
    });
  });

  describe('segundo telefone', () => {
    it('grava o segundo telefone na criação', async () => {
      await service.create(
        { name: 'Maria', secondaryPhone: ' 2422334455 ' },
        'user-1',
      );

      expect(gravadoNoCreate().secondaryPhone).toBe('2422334455');
    });

    it('limpar o segundo telefone grava null', async () => {
      await service.update('pac-1', { secondaryPhone: '' }, 'user-1');

      expect(gravadoNoUpdate().secondaryPhone).toBeNull();
    });
  });

  describe('foto', () => {
    it('aceita foto enviada pela própria conta', async () => {
      await service.create({ name: 'Maria', photoPath: FOTO }, 'user-1');

      expect(gravadoNoCreate().photoPath).toBe(FOTO);
    });

    it.each([
      ['de outra conta', 'patient-photos/owner-b/foto.png'],
      ['de outra pasta', `documents/${OWNER}/laudo.pdf`],
      ['avatar de usuário', 'avatars/foto.png'],
      ['com subpasta', `patient-photos/${OWNER}/x/foto.png`],
      ['com ..', `patient-photos/${OWNER}/../owner-b/foto.png`],
      ['só o prefixo', `patient-photos/${OWNER}/`],
      ['URL externa', 'https://exemplo.com/foto.png'],
    ])('recusa caminho %s', async (_rotulo, caminho) => {
      await expect(
        service.create({ name: 'Maria', photoPath: caminho }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(patientRepository.create).not.toHaveBeenCalled();
    });

    it('trocar a foto apaga a antiga do storage', async () => {
      patientRepository.findOne.mockResolvedValue(
        paciente({ photoPath: `patient-photos/${OWNER}/antiga.png` }),
      );

      await service.update('pac-1', { photoPath: FOTO }, 'user-1');

      expect(gravadoNoUpdate().photoPath).toBe(FOTO);
      expect(storageService.delete).toHaveBeenCalledWith(
        `patient-photos/${OWNER}/antiga.png`,
      );
    });

    it('remover a foto (null) grava null e apaga a antiga', async () => {
      patientRepository.findOne.mockResolvedValue(
        paciente({ photoPath: FOTO }),
      );

      await service.update('pac-1', { photoPath: null }, 'user-1');

      expect(gravadoNoUpdate().photoPath).toBeNull();
      expect(storageService.delete).toHaveBeenCalledWith(FOTO);
    });

    it('troca de foto roda com a linha travada (FOR UPDATE)', async () => {
      patientRepository.findOne.mockResolvedValue(
        paciente({ photoPath: `patient-photos/${OWNER}/antiga.png` }),
      );

      await service.update('pac-1', { photoPath: FOTO }, 'user-1');

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(lidoNaTransacao).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pac-1' },
          lock: { mode: 'pessimistic_write' },
        }),
      );
    });

    it('apaga a foto que o UPDATE substituiu, não a lida no início (corrida com a conversão)', async () => {
      // Lida no início: a PNG. Antes do UPDATE, o script trocou para a WebP.
      patientRepository.findOne.mockResolvedValue(
        paciente({ photoPath: `patient-photos/${OWNER}/antiga.png` }),
      );
      lidoNaTransacao.mockResolvedValue(
        paciente({ photoPath: `patient-photos/${OWNER}/convertida.webp` }),
      );

      await service.update('pac-1', { photoPath: FOTO }, 'user-1');

      expect(storageService.delete).toHaveBeenCalledTimes(1);
      expect(storageService.delete).toHaveBeenCalledWith(
        `patient-photos/${OWNER}/convertida.webp`,
      );
    });

    it('não apaga a antiga se outro paciente ainda a referencia', async () => {
      patientRepository.findOne.mockResolvedValue(
        paciente({ photoPath: `patient-photos/${OWNER}/antiga.png` }),
      );
      // 1ª contagem: validarFoto(FOTO) → livre. 2ª: a antiga → em uso.
      contagemDeUso.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

      await service.update('pac-1', { photoPath: FOTO }, 'user-1');

      expect(gravadoNoUpdate().photoPath).toBe(FOTO);
      expect(contagemDeUso).toHaveBeenLastCalledWith({
        where: { photoPath: `patient-photos/${OWNER}/antiga.png` },
        withDeleted: true,
      });
      expect(storageService.delete).not.toHaveBeenCalled();
    });

    it('recusa foto que já é de outro paciente (create)', async () => {
      contagemDeUso.mockResolvedValue(1);

      await expect(
        service.create({ name: 'Maria', photoPath: FOTO }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(patientRepository.create).not.toHaveBeenCalled();
    });

    it('recusa foto que já é de outro paciente (update), sem gravar nem apagar', async () => {
      patientRepository.findOne.mockResolvedValue(
        paciente({ photoPath: `patient-photos/${OWNER}/antiga.png` }),
      );
      contagemDeUso.mockResolvedValue(1);

      await expect(
        service.update('pac-1', { photoPath: FOTO }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      // A checagem exclui o próprio paciente (manter a mesma foto é válido).
      const where = contagemDeUso.mock.calls[0][0].where;
      expect(where.photoPath).toBe(FOTO);
      expect(where.id).toBeDefined();
      expect(patientRepository.update).not.toHaveBeenCalled();
      expect(storageService.delete).not.toHaveBeenCalled();
    });

    it('update sem photoPath não apaga a foto', async () => {
      patientRepository.findOne.mockResolvedValue(
        paciente({ photoPath: FOTO }),
      );

      await service.update('pac-1', { name: 'Outro' }, 'user-1');

      expect(storageService.delete).not.toHaveBeenCalled();
    });

    it('falha ao apagar a foto antiga não derruba o update', async () => {
      patientRepository.findOne.mockResolvedValue(
        paciente({ photoPath: `patient-photos/${OWNER}/antiga.png` }),
      );
      storageService.delete.mockRejectedValue(new Error('R2 fora'));

      await expect(
        service.update('pac-1', { photoPath: FOTO }, 'user-1'),
      ).resolves.toBeDefined();
    });

    it('findOneWithPhoto devolve a URL assinada da foto', async () => {
      patientRepository.findOne.mockResolvedValue(
        paciente({ photoPath: FOTO }),
      );

      const resultado = await service.findOneWithPhoto('pac-1', 'user-1');

      expect(resultado.photoUrl).toBe(`https://r2/${FOTO}`);
    });

    it('findOneWithPhoto sem foto devolve photoUrl null sem chamar o storage', async () => {
      const resultado = await service.findOneWithPhoto('pac-1', 'user-1');

      expect(resultado.photoUrl).toBeNull();
      expect(storageService.getSignedUrl).not.toHaveBeenCalled();
    });

    it('foto que falha no storage vira photoUrl null, sem erro', async () => {
      patientRepository.findOne.mockResolvedValue(
        paciente({ photoPath: FOTO }),
      );
      storageService.getSignedUrl.mockRejectedValue(new Error('sumiu'));

      const resultado = await service.findOneWithPhoto('pac-1', 'user-1');

      expect(resultado.photoUrl).toBeNull();
    });

    it('createWithPhoto devolve a URL assinada da foto, como o update', async () => {
      const criado = await service.createWithPhoto(
        { name: 'Maria', photoPath: FOTO },
        'user-1',
      );

      expect(criado.photoPath).toBe(FOTO);
      expect(criado.photoUrl).toBe(`https://r2/${FOTO}`);
    });

    it('createWithPhoto sem foto devolve photoUrl null sem chamar o storage', async () => {
      const criado = await service.createWithPhoto({ name: 'Maria' }, 'user-1');

      expect(criado.photoUrl).toBeNull();
      expect(storageService.getSignedUrl).not.toHaveBeenCalled();
    });

    it('create puro (usado pelo assistente) não gera URL assinada', async () => {
      const criado = await service.create(
        { name: 'Maria', photoPath: FOTO },
        'user-1',
      );

      expect(criado).not.toHaveProperty('photoUrl');
      expect(storageService.getSignedUrl).not.toHaveBeenCalled();
    });

    it('findOne puro (usado pelo assistente) não gera URL assinada', async () => {
      patientRepository.findOne.mockResolvedValue(
        paciente({ photoPath: FOTO }),
      );

      const resultado = await service.findOne('pac-1', 'user-1');

      expect(resultado).not.toHaveProperty('photoUrl');
      expect(storageService.getSignedUrl).not.toHaveBeenCalled();
    });

    it('a listagem devolve photoUrl de cada paciente', async () => {
      patientRepository.findAndCountWithSearch.mockResolvedValue([
        [paciente({ id: 'a', photoPath: FOTO }), paciente({ id: 'b' })],
        2,
      ]);

      const { records } = await service.findAll({}, 'user-1');

      expect(records.map((r) => r.photoUrl)).toEqual([
        `https://r2/${FOTO}`,
        null,
      ]);
    });
  });
});
