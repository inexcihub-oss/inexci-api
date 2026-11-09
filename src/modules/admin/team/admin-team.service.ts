import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlatformAuditAction } from 'src/database/entities/platform-audit-log.entity';
import {
  PLATFORM_ADMIN_EMAIL_UNICO,
  PlatformAdminStatus,
} from 'src/database/entities/platform-admin.entity';
import { PlatformAdminRepository } from 'src/database/repositories/platform-admin.repository';
import { PlatformAdminTeamRepository } from 'src/database/repositories/platform-admin-team.repository';
import { violouIndice } from 'src/database/repositories/unique-violation.util';
import { MailService } from 'src/shared/mail/mail.service';
import { errorMessage } from 'src/shared/utils/error-message.util';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { AdminRefreshTokenStore } from '../auth/admin-refresh-token.store';
import {
  buildAdminInviteLink,
  generateAdminInvite,
} from '../auth/admin-invite.util';
import {
  CreatePlatformAdminDto,
  PlatformAdminActionResultDto,
  PlatformAdminMemberDto,
  ResetPlatformAdminAccessDto,
  RevokePlatformAdminDto,
} from './dto/admin-team.dto';

const EMAIL_JA_CADASTRADO = 'E-mail já cadastrado';

@Injectable()
export class AdminTeamService {
  private readonly logger = new Logger(AdminTeamService.name);

  constructor(
    private readonly teamRepository: PlatformAdminTeamRepository,
    private readonly admins: PlatformAdminRepository,
    private readonly audit: PlatformAuditService,
    private readonly refreshStore: AdminRefreshTokenStore,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  async list(): Promise<PlatformAdminMemberDto[]> {
    const rows = await this.teamRepository.listTeam();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      active: row.status === PlatformAdminStatus.ACTIVE,
      status: row.status,
      mfaEnabled: row.mfaEnabled,
      lastSeenAt: row.lastSeenAt,
      createdBy: row.createdByName,
      createdById: row.createdById,
      createdAt: row.createdAt,
    }));
  }

  async create(
    dto: CreatePlatformAdminDto,
    actorAdminId: string,
  ): Promise<PlatformAdminActionResultDto> {
    const email = dto.email.trim().toLowerCase();
    if (await this.admins.findByEmail(email)) {
      throw new ConflictException(EMAIL_JA_CADASTRADO);
    }

    const entry = await this.audit.begin({
      actorAdminId,
      action: PlatformAuditAction.PLATFORM_ADMIN_CREATED,
      before: null,
    });
    const { token, invite } = generateAdminInvite();
    let adminId: string;
    try {
      const criado = await this.admins.createInvited({
        name: dto.name,
        email,
        createdById: actorAdminId,
        invite,
      });
      adminId = criado.id;
    } catch (err) {
      await this.audit.fail(entry.id, 'Falha ao criar o administrador');
      if (violouIndice(err, PLATFORM_ADMIN_EMAIL_UNICO)) {
        throw new ConflictException(EMAIL_JA_CADASTRADO);
      }
      throw err;
    }

    await this.audit.succeed(entry.id, {
      targetAdminId: adminId,
      after: { email, name: dto.name, status: PlatformAdminStatus.PENDING },
    });
    await this.sendInvite(adminId, dto.name, email, token, actorAdminId);
    return { id: adminId, auditId: entry.id };
  }

  async revoke(
    adminId: string,
    dto: RevokePlatformAdminDto,
    actorAdminId: string,
  ): Promise<PlatformAdminActionResultDto> {
    if (adminId === actorAdminId) {
      throw new ConflictException(
        'Você não pode revogar o próprio acesso de administrador',
      );
    }
    const entry = await this.audit.begin({
      actorAdminId,
      action: PlatformAuditAction.PLATFORM_ADMIN_REVOKED,
      targetAdminId: adminId,
      reason: dto.reason,
    });

    let outcome: Awaited<
      ReturnType<PlatformAdminTeamRepository['revokeKeepingOneActive']>
    >;
    try {
      outcome = await this.teamRepository.revokeKeepingOneActive(adminId);
    } catch (err) {
      await this.audit.fail(entry.id, 'Falha ao revogar o administrador');
      throw err;
    }
    if (outcome.result === 'not_found') {
      await this.audit.fail(entry.id, 'Administrador não encontrado');
      throw new NotFoundException('Administrador não encontrado');
    }
    if (outcome.result === 'already_inactive') {
      await this.audit.fail(entry.id, 'Administrador já revogado');
      throw new ConflictException('Este administrador já está revogado');
    }
    if (outcome.result === 'last_active_admin') {
      await this.audit.fail(entry.id, 'Último administrador ativo');
      throw new ConflictException(
        'Não é possível revogar o último administrador ativo',
      );
    }

    await this.derrubarSessoes(adminId);
    await this.audit.succeed(entry.id, {
      after: { status: PlatformAdminStatus.INACTIVE },
    });
    return { id: adminId, auditId: entry.id };
  }

  async resetAccess(
    adminId: string,
    dto: ResetPlatformAdminAccessDto,
    actorAdminId: string,
  ): Promise<PlatformAdminActionResultDto> {
    if (adminId === actorAdminId) {
      throw new ConflictException(
        'Você não pode redefinir o próprio acesso de administrador',
      );
    }
    const entry = await this.audit.begin({
      actorAdminId,
      action: PlatformAuditAction.PLATFORM_ADMIN_ACCESS_RESET,
      targetAdminId: adminId,
      reason: dto.reason,
    });

    const { token, invite } = generateAdminInvite();
    let outcome: Awaited<
      ReturnType<PlatformAdminTeamRepository['resetAccess']>
    >;
    try {
      outcome = await this.teamRepository.resetAccess(adminId, invite);
    } catch (err) {
      await this.audit.fail(entry.id, 'Falha ao redefinir o acesso');
      throw err;
    }
    if (outcome.result === 'not_found') {
      await this.audit.fail(entry.id, 'Administrador não encontrado');
      throw new NotFoundException('Administrador não encontrado');
    }

    await this.derrubarSessoes(adminId);
    await this.audit.succeed(entry.id, {
      after: {
        status: PlatformAdminStatus.PENDING,
        mfaEnabled: false,
        previousStatus: outcome.before.status,
        previousMfaEnabled: outcome.before.mfaEnabled,
      },
    });
    await this.sendInvite(
      adminId,
      outcome.name,
      outcome.email,
      token,
      actorAdminId,
    );
    return { id: adminId, auditId: entry.id };
  }

  private async derrubarSessoes(adminId: string): Promise<void> {
    try {
      await this.refreshStore.revokeAllForUser(adminId);
    } catch (err) {
      this.logger.warn(
        `Falha ao apagar os refresh tokens do administrador ${adminId}; o token_version já invalida a sessão: ${errorMessage(err)}`,
      );
    }
  }

  private async sendInvite(
    adminId: string,
    name: string,
    email: string,
    token: string,
    actorAdminId: string,
  ): Promise<void> {
    try {
      const inviterName =
        (await this.admins.findName(actorAdminId)) ?? 'Inexci';
      const setupLink = buildAdminInviteLink(
        this.configService.get<string>('DASHBOARD_URL'),
        email,
        token,
      );
      await this.mailService.send(
        'invite-platform-admin',
        email,
        'Convite para o painel administrativo da Inexci',
        { adminName: name, inviterName, email, setupLink },
      );
    } catch (err) {
      this.logger.warn(
        `Falha ao enviar o convite do administrador adminId=${adminId}: ${errorMessage(err)}`,
      );
    }
  }
}
