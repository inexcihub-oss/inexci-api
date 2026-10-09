import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { auditProntuarioAccess } from 'src/shared/logging/audit';
import { AccessControlService } from 'src/shared/services/access-control.service';

export const SKIP_SURGERY_OWNER = 'skipSurgeryOwner';

export const SkipSurgeryOwner = () => SetMetadata(SKIP_SURGERY_OWNER, true);

@Injectable()
export class SurgeryRequestOwnerGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_SURGERY_OWNER, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (skip) return true;

    const req = ctx.switchToHttp().getRequest();
    const id: string | undefined =
      req.params?.surgeryRequestId ??
      req.params?.id ??
      req.query?.surgeryRequestId ??
      req.query?.id ??
      req.body?.surgeryRequestId ??
      req.body?.id;

    if (!id) return true;

    if (!isUUID(String(id)))
      throw new NotFoundException('Solicitação cirúrgica não encontrada');

    const sr = await this.surgeryRequestRepository.findOneSimple({ id });
    if (!sr)
      throw new NotFoundException('Solicitação cirúrgica não encontrada');
    if (sr.ownerId !== req.user?.ownerId)
      throw new ForbiddenException(
        'Acesso negado: recurso pertence a outra clínica.',
      );

    const podeAcessarMedico = await this.accessControlService.canAccessDoctor(
      req.user.userId,
      sr.doctorId,
    );
    if (!podeAcessarMedico)
      throw new ForbiddenException(
        'Acesso negado: você não tem vínculo com o médico desta solicitação.',
      );

    auditProntuarioAccess({
      resource: 'surgery_request',
      resourceId: id,
      action: req.method,
      actorUserId: req.user?.userId,
      tenantId: req.user?.ownerId,
    });

    return true;
  }
}
