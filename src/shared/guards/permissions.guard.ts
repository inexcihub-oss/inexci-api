import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const exigidas = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!exigidas || exigidas.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    const concedidas: Permission[] = user?.permissions ?? [];

    if (exigidas.some((p) => concedidas.includes(p))) return true;

    throw new ForbiddenException('Você não tem permissão para esta ação.');
  }
}
