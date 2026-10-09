import { SetMetadata } from '@nestjs/common';
import { ALL_PERMISSIONS, Permission } from 'src/shared/permissions';

export const PERMISSIONS_KEY = 'required_permissions';

export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const RequireAnyArea = () =>
  SetMetadata(PERMISSIONS_KEY, [...ALL_PERMISSIONS]);
