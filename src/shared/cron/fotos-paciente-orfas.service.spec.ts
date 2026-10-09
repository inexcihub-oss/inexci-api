import { Repository } from 'typeorm';
import { Patient } from 'src/database/entities/patient.entity';
import { StorageService } from 'src/shared/storage/storage.service';
import { FotosPacienteOrfasService } from './fotos-paciente-orfas.service';

const AGORA = new Date('2026-10-08T12:00:00.000Z');
const HORA = 60 * 60 * 1000;
const haHoras = (h: number) => new Date(AGORA.getTime() - h * HORA);

describe('FotosPacienteOrfasService', () => {
  let storage: { listAll: jest.Mock; deleteMany: jest.Mock };
  let repo: { query: jest.Mock };
  let service: FotosPacienteOrfasService;

  beforeEach(() => {
    storage = {
      listAll: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue([]),
    };
    repo = { query: jest.fn().mockResolvedValue([]) };
    service = new FotosPacienteOrfasService(
      storage as unknown as StorageService,
      repo as unknown as Repository<Patient>,
    );
  });

  it('apaga só o objeto não referenciado e mais velho que a janela', async () => {
    storage.listAll.mockResolvedValue([
      { key: 'patient-photos/o/orfa.webp', lastModified: haHoras(30) },
      { key: 'patient-photos/o/em-uso.webp', lastModified: haHoras(30) },
      { key: 'patient-photos/o/recente.webp', lastModified: haHoras(2) },
      { key: 'patient-photos/o/sem-data.webp', lastModified: null },
    ]);
    repo.query.mockResolvedValue([
      { photo_path: 'patient-photos/o/em-uso.webp' },
    ]);

    const resultado = await service.limpar(AGORA);

    expect(storage.listAll).toHaveBeenCalledWith('patient-photos');
    expect(repo.query.mock.calls[0][1]).toEqual([
      ['patient-photos/o/orfa.webp', 'patient-photos/o/em-uso.webp'],
    ]);
    expect(storage.deleteMany).toHaveBeenCalledWith([
      'patient-photos/o/orfa.webp',
    ]);
    expect(resultado).toEqual({ removidas: 1, falhas: 0 });
  });

  it('a consulta de referência não filtra soft delete (paciente excluído mantém a foto)', async () => {
    storage.listAll.mockResolvedValue([
      { key: 'patient-photos/o/a.webp', lastModified: haHoras(48) },
    ]);
    await service.limpar(AGORA);
    expect(repo.query.mock.calls[0][0]).not.toMatch(/deleted_at/i);
  });

  it('nada a apagar: não chama o deleteMany', async () => {
    storage.listAll.mockResolvedValue([
      { key: 'patient-photos/o/a.webp', lastModified: haHoras(48) },
    ]);
    repo.query.mockResolvedValue([{ photo_path: 'patient-photos/o/a.webp' }]);

    await expect(service.limpar(AGORA)).resolves.toEqual({
      removidas: 0,
      falhas: 0,
    });
    expect(storage.deleteMany).not.toHaveBeenCalled();
  });

  it('conta como falha o que o R2 não apagou', async () => {
    storage.listAll.mockResolvedValue([
      { key: 'patient-photos/o/a.webp', lastModified: haHoras(48) },
      { key: 'patient-photos/o/b.webp', lastModified: haHoras(48) },
    ]);
    storage.deleteMany.mockResolvedValue(['patient-photos/o/b.webp']);

    await expect(service.limpar(AGORA)).resolves.toEqual({
      removidas: 1,
      falhas: 1,
    });
  });

  it('processa em lotes de 1000 chaves', async () => {
    storage.listAll.mockResolvedValue(
      Array.from({ length: 1500 }, (_, i) => ({
        key: `patient-photos/o/${i}.webp`,
        lastModified: haHoras(48),
      })),
    );

    await service.limpar(AGORA);

    expect(repo.query).toHaveBeenCalledTimes(2);
    expect(repo.query.mock.calls[0][1][0]).toHaveLength(1000);
    expect(repo.query.mock.calls[1][1][0]).toHaveLength(500);
    expect(storage.deleteMany).toHaveBeenCalledTimes(2);
  });

  it('falha na listagem propaga (o cron registra e não apaga nada)', async () => {
    storage.listAll.mockRejectedValue(new Error('R2 fora'));
    await expect(service.limpar(AGORA)).rejects.toThrow('R2 fora');
    expect(storage.deleteMany).not.toHaveBeenCalled();
  });
});
