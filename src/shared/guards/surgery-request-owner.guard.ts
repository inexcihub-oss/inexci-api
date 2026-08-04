import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { auditProntuarioAccess } from 'src/shared/logging/audit';
import { AccessControlService } from 'src/shared/services/access-control.service';

export const SKIP_SURGERY_OWNER = 'skipSurgeryOwner';

/**
 * Opt-out do `SurgeryRequestOwnerGuard` para rotas cujo `:id`/`id` NÃO é o id
 * de uma solicitação cirúrgica (ex.: `templates/:id`, onde `:id` é o template).
 */
export const SkipSurgeryOwner = () => SetMetadata(SKIP_SURGERY_OWNER, true);

/**
 * Guard de posse (tenant isolation) para o módulo de solicitações cirúrgicas.
 *
 * Resolve o id da SC a partir de params/query/body e garante que ela pertence
 * ao `ownerId` (clínica) do usuário autenticado. Fail-closed: bloqueia com 403
 * qualquer acesso cross-tenant e cobre automaticamente rotas futuras (V1).
 *
 * LIMITAÇÃO: rotas `multipart/form-data` não são cobertas. Guards rodam antes
 * dos interceptors, então o `FileInterceptor` ainda não parseou o corpo e o id
 * chega `undefined` aqui. Essas rotas devem validar a posse no service (ver
 * `DocumentsService.create`).
 */
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

    // Sem id de recurso (listagens, criação): nada a validar aqui.
    if (!id) return true;

    const sr = await this.surgeryRequestRepository.findOneSimple({ id });
    if (!sr)
      throw new NotFoundException('Solicitação cirúrgica não encontrada');
    if (sr.ownerId !== req.user?.ownerId)
      throw new ForbiddenException(
        'Acesso negado: recurso pertence a outra clínica.',
      );

    // Segundo recorte: dentro da clínica, o usuário só alcança as SCs dos
    // médicos aos quais está vinculado (user_doctor_access). Sem isto, rotas
    // de workflow davam escrita e export de PDF sobre SCs que a leitura normal
    // (GET /:id) já negava.
    const podeAcessarMedico = await this.accessControlService.canAccessDoctor(
      req.user.userId,
      sr.doctorId,
    );
    if (!podeAcessarMedico)
      throw new ForbiddenException(
        'Acesso negado: você não tem vínculo com o médico desta solicitação.',
      );

    // Auditoria LGPD: acesso autorizado a uma SC específica (prontuário).
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
