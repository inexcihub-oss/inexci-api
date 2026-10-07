import { ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ClinicRoomsService } from './clinic-rooms.service';
import { UpdateClinicRoomDto } from './dto/clinic-room.dto';
import { ClinicRepository } from 'src/database/repositories/clinic.repository';
import { ClinicRoomRepository } from 'src/database/repositories/clinic-room.repository';
import { AccessControlService } from 'src/shared/services/access-control.service';

describe('ClinicRoomsService', () => {
  const clinicRepository = { findOne: jest.fn() };
  const roomRepository = {
    findByClinic: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((d) => Promise.resolve({ id: 'r-new', ...d })),
    update: jest.fn((id, d) => Promise.resolve({ id, ...d })),
    delete: jest.fn(),
  };
  const access = { getOwnerId: jest.fn() };
  const service = new ClinicRoomsService(
    clinicRepository as unknown as ClinicRepository,
    roomRepository as unknown as ClinicRoomRepository,
    access as unknown as AccessControlService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    access.getOwnerId.mockResolvedValue('owner-a');
    clinicRepository.findOne.mockResolvedValue({
      id: 'c1',
      ownerId: 'owner-a',
    });
    roomRepository.findByClinic.mockResolvedValue([
      { id: 'r1', name: 'Consultório 01', ownerId: 'owner-a', clinicId: 'c1' },
    ]);
    roomRepository.findOne.mockResolvedValue({
      id: 'r1',
      name: 'Consultório 01',
      ownerId: 'owner-a',
      clinicId: 'c1',
    });
  });

  it('lista as salas da clínica da conta', async () => {
    await expect(service.list('c1', 'u')).resolves.toHaveLength(1);
    expect(roomRepository.findByClinic).toHaveBeenCalledWith('owner-a', 'c1');
  });

  it('clínica de outra conta responde 404', async () => {
    clinicRepository.findOne.mockResolvedValue({
      id: 'c1',
      ownerId: 'owner-b',
    });

    await expect(service.list('c1', 'u')).rejects.toThrow(NotFoundException);
    await expect(service.create('c1', { name: 'X' }, 'u')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('cria sala ativa na clínica, com nome aparado', async () => {
    const sala = await service.create('c1', { name: '  Consultório 02 ' }, 'u');

    expect(roomRepository.create).toHaveBeenCalledWith({
      ownerId: 'owner-a',
      clinicId: 'c1',
      name: 'Consultório 02',
      active: true,
    });
    expect(sala.name).toBe('Consultório 02');
  });

  it('recusa nome repetido na mesma clínica, sem diferenciar caixa', async () => {
    await expect(
      service.create('c1', { name: 'consultório 01' }, 'u'),
    ).rejects.toThrow(ConflictException);
  });

  it('renomear para o próprio nome não conflita', async () => {
    await expect(
      service.update('c1', 'r1', { name: 'Consultório 01' }, 'u'),
    ).resolves.toBeDefined();
  });

  it('desativa a sala', async () => {
    await service.update('c1', 'r1', { active: false }, 'u');

    expect(roomRepository.update).toHaveBeenCalledWith('r1', { active: false });
  });

  it('sala de outra clínica responde 404 ao editar e excluir', async () => {
    roomRepository.findOne.mockResolvedValue({
      id: 'r9',
      ownerId: 'owner-a',
      clinicId: 'outra',
    });

    await expect(
      service.update('c1', 'r9', { active: false }, 'u'),
    ).rejects.toThrow(NotFoundException);
    await expect(service.delete('c1', 'r9', 'u')).rejects.toThrow(
      NotFoundException,
    );
    expect(roomRepository.delete).not.toHaveBeenCalled();
  });

  it('PATCH de sala: nome ou ativo nulos são recusados; ausentes passam', async () => {
    const erros = async (body: object) =>
      (await validate(plainToInstance(UpdateClinicRoomDto, body)))
        .map((e) => e.property)
        .sort();
    await expect(erros({ name: null, active: null })).resolves.toEqual([
      'active',
      'name',
    ]);
    await expect(erros({})).resolves.toEqual([]);
    await expect(erros({ active: false })).resolves.toEqual([]);
  });
});
