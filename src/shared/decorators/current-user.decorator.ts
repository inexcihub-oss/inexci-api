import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from 'src/database/entities/user.entity';
import { Permission } from 'src/shared/permissions';

export interface AuthenticatedUser {
  userId: string;
  ownerId: string | null;
  role: UserRole;
  isPlatformAdmin?: boolean;
  /** Permissão **efetiva**, já derivada na JwtStrategy. */
  permissions: Permission[];
}

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
