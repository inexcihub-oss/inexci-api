import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from 'src/database/entities/user.entity';

export interface AuthenticatedUser {
  userId: string;
  ownerId: string | null;
  role: UserRole;
}

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
