import { Reflector } from '@nestjs/core';
import { Permission } from 'src/shared/permissions';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { ReportsController } from './reports.controller';

describe('ReportsController — permissões declaradas', () => {
  it('exige administração no dashboard', () => {
    const exigido = new Reflector().getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [ReportsController.prototype.dashboardFull, ReportsController],
    );
    expect(exigido).toEqual([Permission.ADMINISTRACAO]);
  });
});
