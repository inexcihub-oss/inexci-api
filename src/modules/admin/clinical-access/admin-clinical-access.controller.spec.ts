import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AdminClinicalAccessController } from './admin-clinical-access.controller';
import {
  AdminClinicalAccessExportDto,
  AdminClinicalAccessPatientDto,
} from './dto/admin-clinical-access.dto';

describe('AdminClinicalAccessController', () => {
  const service = {
    forAccount: jest.fn().mockResolvedValue('volume'),
    export: jest.fn().mockResolvedValue('exportado'),
    forPatient: jest.fn().mockResolvedValue('paciente'),
  };
  const controller = new AdminClinicalAccessController(service as never);

  it('repassa conta, período e motivo com o admin autenticado', async () => {
    await expect(controller.forAccount('o1', { days: 90 })).resolves.toBe(
      'volume',
    );
    expect(service.forAccount).toHaveBeenCalledWith('o1', 90);
    await expect(
      controller.export('o1', { adminId: 'admin-1' } as never, {
        reason: 'Pedido da clínica',
        days: 7,
      }),
    ).resolves.toBe('exportado');
    expect(service.export).toHaveBeenCalledWith(
      'o1',
      { reason: 'Pedido da clínica', days: 7 },
      'admin-1',
    );
  });

  it('exportação exige motivo', async () => {
    const semMotivo = plainToInstance(AdminClinicalAccessExportDto, {
      days: 30,
    });
    expect(await validate(semMotivo)).not.toHaveLength(0);
  });

  it('consulta por paciente repassa motivo, paciente e período', async () => {
    await expect(
      controller.forPatient('o1', { adminId: 'admin-1' } as never, {
        reason: 'Pedido da clínica',
        patient: 'a1b2c3d4e5',
        days: 30,
      }),
    ).resolves.toBe('paciente');
    expect(service.forPatient).toHaveBeenCalledWith(
      'o1',
      { reason: 'Pedido da clínica', patient: 'a1b2c3d4e5', days: 30 },
      'admin-1',
    );
  });

  it.each([
    ['código do painel', 'a1b2c3d4e5', 0],
    ['id completo', '3f2504e0-4f89-11d3-9a0c-0305e82c3301', 0],
    ['nome do paciente', 'Maria Silva', 1],
    ['código curto', 'a1b2', 1],
  ])('consulta por paciente valida %s', async (_n, patient, erros) => {
    const dto = plainToInstance(AdminClinicalAccessPatientDto, {
      reason: 'Pedido da clínica',
      patient,
    });
    expect(await validate(dto)).toHaveLength(erros);
  });

  it('consulta por paciente exige motivo', async () => {
    const dto = plainToInstance(AdminClinicalAccessPatientDto, {
      patient: 'a1b2c3d4e5',
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
