import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FOTO_EXPIRADA, PatientsService } from './patients.service';
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
    countByPhotoPath?: (photoPath: string, id?: string) => Promise<number>;
    updateReturningPreviousPhoto?: (
      id: string,
      dados: Partial<Patient>,
    ) => Promise<string | null>;
  };
  let contagemDeUso: jest.Mock;
  let lidoNaTransacao: jest.Mock;
  let transaction: jest.Mock;
  let storageService: {
    getSignedUrl: jest.Mock;
    delete: jest.Mock;
    exists: jest.Mock;
  };

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
    const repositorioReal = new PatientRepository({
      getRepository: () => ({ count: contagemDeUso, manager: { transaction } }),
    } as never);
    patientRepository.countByPhotoPath = (photoPath: string, id?: string) =>
      repositorioReal.countByPhotoPath(photoPath, id);
    patientRepository.updateReturningPreviousPhoto = (
      id: string,
      dados: Partial<Patient>,
    ) => repositorioReal.updateReturningPreviousPhoto(id, dados);
    storageService = {
      getSignedUrl: jest.fn((p: string) => Promise.resolve(`https://r2/${p}`)),
      delete: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(true),
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

    describe('foto que sumiu do bucket', () => {
      it('cadastro: recusa com 400 "expirou" e não grava', async () => {
        storageService.exists.mockResolvedValue(false);

        const erro = service.create(
          { name: 'Maria', photoPath: FOTO },
          'user-1',
        );

        await expect(erro).rejects.toThrow(BadRequestException);
        await expect(erro).rejects.toThrow(FOTO_EXPIRADA);
        expect(storageService.exists).toHaveBeenCalledWith(FOTO);
        expect(patientRepository.create).not.toHaveBeenCalled();
      });

      it('troca: recusa e não apaga a foto atual', async () => {
        patientRepository.findOne.mockResolvedValue(
          paciente({ photoPath: `patient-photos/${OWNER}/antiga.png` }),
        );
        storageService.exists.mockResolvedValue(false);

        await expect(
          service.update('pac-1', { photoPath: FOTO }, 'user-1'),
        ).rejects.toThrow(FOTO_EXPIRADA);
        expect(patientRepository.update).not.toHaveBeenCalled();
        expect(storageService.delete).not.toHaveBeenCalled();
      });

      it('PATCH que reenvia a foto que o paciente já tem não confere o bucket', async () => {
        patientRepository.findOne.mockResolvedValue(
          paciente({ photoPath: FOTO }),
        );
        storageService.exists.mockResolvedValue(false);

        await service.update(
          'pac-1',
          { photoPath: FOTO, name: 'Maria S.' },
          'user-1',
        );

        expect(storageService.exists).not.toHaveBeenCalled();
        expect(gravadoNoUpdate().name).toBe('Maria S.');
      });

      it('R2 fora: 503, sem gravar caminho que não deu para confirmar', async () => {
        storageService.exists.mockRejectedValue(new Error('R2 fora'));

        await expect(
          service.create({ name: 'Maria', photoPath: FOTO }, 'user-1'),
        ).rejects.toThrow(ServiceUnavailableException);
        expect(patientRepository.create).not.toHaveBeenCalled();
      });

      it('remover a foto (null) não consulta o bucket', async () => {
        patientRepository.findOne.mockResolvedValue(
          paciente({ photoPath: FOTO }),
        );

        await service.update('pac-1', { photoPath: null }, 'user-1');

        expect(storageService.exists).not.toHaveBeenCalled();
      });
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
  describe('corrida na foto (índice único UQ_patients_photo_path)', () => {
    const violacao = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'UQ_patients_photo_path',
    });

    it('create: 23505 do índice da foto vira 400, como a checagem', async () => {
      patientRepository.create.mockRejectedValueOnce(violacao);

      await expect(
        service.create({ name: 'Maria', photoPath: FOTO }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('update: 23505 do índice da foto vira 400 e não apaga nada', async () => {
      patientRepository.update.mockRejectedValueOnce(violacao);
      patientRepository.findOne.mockResolvedValue(
        paciente({ photoPath: `patient-photos/${OWNER}/antiga.webp` }),
      );

      await expect(
        service.update('pac-1', { photoPath: FOTO }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storageService.delete).not.toHaveBeenCalled();
    });

    it('outro erro de banco passa adiante sem virar 400', async () => {
      patientRepository.create.mockRejectedValueOnce(
        Object.assign(new Error('x'), { code: '23505', constraint: 'outro' }),
      );

      await expect(
        service.create({ name: 'Maria', photoPath: FOTO }, 'user-1'),
      ).rejects.not.toBeInstanceOf(BadRequestException);
    });
  });

  describe('descartarFotoNaoUsada', () => {
    it('apaga a foto da conta que nenhum paciente referencia', async () => {
      await service.descartarFotoNaoUsada(FOTO, 'user-1');

      expect(contagemDeUso.mock.calls[0][0]).toMatchObject({
        where: { photoPath: FOTO },
        withDeleted: true,
      });
      expect(storageService.delete).toHaveBeenCalledWith(FOTO);
    });

    it('não apaga foto que algum paciente (inclusive excluído) referencia', async () => {
      contagemDeUso.mockResolvedValue(1);

      await service.descartarFotoNaoUsada(FOTO, 'user-1');

      expect(storageService.delete).not.toHaveBeenCalled();
    });

    it.each([
      ['de outra conta', 'patient-photos/owner-b/uuid-foto.png'],
      ['de outra pasta', `documents/${OWNER}/laudo.pdf`],
      ['com subpasta', `patient-photos/${OWNER}/x/foto.png`],
      ['com ..', `patient-photos/${OWNER}/..foto.png`],
      ['vazio', '   '],
    ])('recusa caminho %s sem tocar no storage', async (_, caminho) => {
      await expect(
        service.descartarFotoNaoUsada(caminho, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storageService.delete).not.toHaveBeenCalled();
    });

    it('falha do storage não vira erro (best-effort)', async () => {
      storageService.delete.mockRejectedValueOnce(new Error('R2 fora'));

      await expect(
        service.descartarFotoNaoUsada(FOTO, 'user-1'),
      ).resolves.toBeUndefined();
    });
  });
});
