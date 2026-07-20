import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/**
 * Exige que o usuário seja **administrador da plataforma** (`isPlatformAdmin`),
 * não apenas dono de um tenant. Protege `/admin/*` (V2): como todo `register`
 * cria `role=ADMIN`, checar o role não restringe ninguém — só esta flag,
 * setável exclusivamente via seed/migration, delimita o admin de plataforma.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const { user } = ctx.switchToHttp().getRequest();
    if (!user?.isPlatformAdmin) {
      throw new ForbiddenException('Requer administrador de plataforma.');
    }
    return true;
  }
}
