import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Public } from 'src/shared/decorators/is-public.decorator';
import { SkipConsentCheck } from 'src/shared/decorators/skip-consent-check.decorator';
import {
  AdminSessionGuard,
  AuthenticatedAdmin,
  RequestComAdmin,
} from './admin-session.guard';

export const PlatformAdminOnly = () =>
  applyDecorators(
    Public(),
    SkipConsentCheck(),
    UseGuards(AdminSessionGuard),
    ApiBearerAuth(),
  );

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedAdmin => {
    const request = ctx.switchToHttp().getRequest<RequestComAdmin>();
    return request.admin as AuthenticatedAdmin;
  },
);
