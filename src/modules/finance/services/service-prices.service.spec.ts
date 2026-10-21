import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AppointmentType } from 'src/database/entities/appointment.entity';
import {
  MEDICO_FORA_DA_CONTA,
  ServicePricesService,
} from './service-prices.service';

describe('ServicePricesService', () => {
  const OWNER = 'owner-1';
  const OUTRO_OWNER = 'owner-2';
  const MEDICO = 'medico-1';

  const repo = {
    findByOwner: jest.fn(),
    findOwned: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    hardDelete: jest.fn(),
    resolvePrice: jest.fn(),
  };
  const users = { findDoctorsByOwnerId: jest.fn() };

  let service: ServicePricesService;

  const registro = (extra: Record<string, unknown> = {}) => ({
    id: 'sp-1',
    ownerId: OWNER,
    doctorId: MEDICO,
    doctor: { id: MEDICO, name: 'Dr. House', email: 'x@y.z' },
    appointmentType: AppointmentType.FIRST_VISIT,
    description: 'Consulta ortopédica',
    amount: '300',
    active: true,
    ...extra,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    users.findDoctorsByOwnerId.mockImplementation((ownerId: string) =>
      Promise.resolve(ownerId === OWNER ? [{ id: MEDICO }] : []),
    );
    repo.findOwned.mockImplementation((id: string, ownerId: string) =>
      Promise.resolve(ownerId === OWNER && id === 'sp-1' ? registro() : null),
    );
    repo.create.mockImplementation((d: object) =>
      Promise.resolve({ id: 'sp-1', ...d }),
    );
    service = new ServicePricesService(repo as never, users as never);
  });

  it('lista só a tabela do tenant, com o médico reduzido a id e nome', async () => {
    repo.findByOwner.mockResolvedValue([registro()]);

    const lista = await service.list(OWNER);

    expect(repo.findByOwner).toHaveBeenCalledWith(OWNER);
    expect(lista).toEqual([
      {
        id: 'sp-1',
        doctorId: MEDICO,
        doctor: { id: MEDICO, name: 'Dr. House' },
        appointmentType: AppointmentType.FIRST_VISIT,
        description: 'Consulta ortopédica',
        amount: '300.00',
        active: true,
      },
    ]);
  });

  it('cria com o owner do usuário e normaliza o valor', async () => {
    await service.create(OWNER, 'user-1', {
      doctorId: MEDICO,
      description: 'Consulta',
      amount: '300.5',
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: OWNER,
        createdById: 'user-1',
        doctorId: MEDICO,
        appointmentType: null,
        amount: '300.50',
        active: true,
      }),
    );
  });

  it('recusa médico de outra conta na criação', async () => {
    await expect(
      service.create(OUTRO_OWNER, 'user-2', {
        doctorId: MEDICO,
        description: 'Consulta',
        amount: '300.00',
      }),
    ).rejects.toThrow(new BadRequestException(MEDICO_FORA_DA_CONTA));
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('recusa médico de outra conta na edição', async () => {
    users.findDoctorsByOwnerId.mockResolvedValue([{ id: 'outro' }]);

    await expect(
      service.update(OWNER, 'user-2', 'sp-1', { doctorId: MEDICO }),
    ).rejects.toThrow(BadRequestException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('cria preço para todos os médicos sem consultar médicos', async () => {
    await service.create(OWNER, 'user-1', {
      description: 'Geral',
      amount: '200',
    });

    expect(users.findDoctorsByOwnerId).not.toHaveBeenCalled();
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ doctorId: null, amount: '200.00' }),
    );
  });

  it.each([
    [
      'edição',
      (s: ServicePricesService) => s.update(OUTRO_OWNER, 'user-2', 'sp-1', {}),
    ],
    ['exclusão', (s: ServicePricesService) => s.remove(OUTRO_OWNER, 'sp-1')],
  ])('%s de preço de outra conta responde 404', async (_n, acao) => {
    await expect(acao(service)).rejects.toThrow(NotFoundException);
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.hardDelete).not.toHaveBeenCalled();
  });

  it('edita só os campos enviados', async () => {
    await service.update(OWNER, 'user-2', 'sp-1', {
      amount: '350',
      appointmentType: null,
      active: false,
    });

    expect(repo.update).toHaveBeenCalledWith('sp-1', {
      amount: '350.00',
      appointmentType: null,
      active: false,
      updatedById: 'user-2',
    });
  });

  it('exclui de verdade, escopado pelo owner', async () => {
    await service.remove(OWNER, 'sp-1');

    expect(repo.hardDelete).toHaveBeenCalledWith('sp-1', OWNER);
  });

  it('resolve no tenant do usuário e devolve o valor normalizado', async () => {
    repo.resolvePrice.mockResolvedValue({ id: 'sp-9', amount: '300' });

    await expect(
      service.resolve(OWNER, {
        doctorId: MEDICO,
        type: AppointmentType.RETURN,
      }),
    ).resolves.toEqual({ amount: '300.00', servicePriceId: 'sp-9' });
    expect(repo.resolvePrice).toHaveBeenCalledWith(OWNER, {
      doctorId: MEDICO,
      type: AppointmentType.RETURN,
    });
  });

  it('sem regra aplicável, resolve devolve nulos', async () => {
    repo.resolvePrice.mockResolvedValue(null);

    await expect(
      service.resolve(OWNER, { doctorId: null, type: null }),
    ).resolves.toEqual({ amount: null, servicePriceId: null });
  });
});
