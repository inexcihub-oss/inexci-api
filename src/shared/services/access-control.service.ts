import {
  hasCouncilRegistry,
  isClinicalDocumentIssuerProfile,
  isPhysicianProfile,
} from 'src/database/entities/doctor-profile.entity';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FindOptionsWhere, In } from 'typeorm';
import { UserRepository } from '../../database/repositories/user.repository';
import { DoctorProfileRepository } from '../../database/repositories/doctor-profile.repository';
import { UserDoctorAccessRepository } from '../../database/repositories/user-doctor-access.repository';
import {
  User,
  UserRole,
  UserStatus,
} from '../../database/entities/user.entity';
import { SurgeryRequest } from '../../database/entities/surgery-request.entity';
import { Permission, resolveEffectivePermissions } from '../permissions';

export function resolverOwnerIdDoUsuario(
  user: Pick<User, 'id' | 'ownerId' | 'adminId'>,
): string {
  return user.ownerId ?? user.adminId ?? user.id;
}

const ACCESSIBLE_DOCTORS_CACHE_TTL_MS = 90_000;

@Injectable()
export class AccessControlService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly doctorProfileRepository: DoctorProfileRepository,
    private readonly userDoctorAccessRepository: UserDoctorAccessRepository,
  ) {}

  private readonly accessibleDoctorsCache = new Map<
    string,
    { ids: string[]; expiresAt: number }
  >();

  invalidateAccessibleDoctors(userId: string): void {
    this.accessibleDoctorsCache.delete(userId);
  }

  async getAccessibleDoctorIds(userId: string): Promise<string[]> {
    const cached = this.accessibleDoctorsCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.ids;
    }

    const ids = await this.computeAccessibleDoctorIds(userId);
    this.accessibleDoctorsCache.set(userId, {
      ids,
      expiresAt: Date.now() + ACCESSIBLE_DOCTORS_CACHE_TTL_MS,
    });
    return ids;
  }

  private async computeAccessibleDoctorIds(userId: string): Promise<string[]> {
    const user = await this.userRepository.findOneWithProfile({ id: userId });
    if (!user) return [];

    if (user.role === UserRole.ADMIN) {
      const doctors = await this.userRepository.findDoctorsByOwnerId(
        user.ownerId,
      );
      return doctors.map((d) => d.id);
    }

    const ids: string[] = [];

    if (user.doctorProfile) {
      ids.push(user.id);
    }

    const accesses =
      await this.userDoctorAccessRepository.findActiveByUserId(userId);
    ids.push(...accesses.map((a) => a.doctorUserId));

    return [...new Set(ids)];
  }

  async getAvailableDoctorsForCreation(userId: string): Promise<User[]> {
    const user = await this.userRepository.findOneWithProfile({ id: userId });
    if (!user) return [];

    if (user.role === UserRole.ADMIN) {
      return this.userRepository.findDoctorsByOwnerId(user.ownerId);
    }

    const doctors: User[] = [];

    if (user.doctorProfile) {
      doctors.push(user);
    }

    const accesses =
      await this.userDoctorAccessRepository.findActiveByUserId(userId);
    const doctorIds = accesses.map((a) => a.doctorUserId);
    const doctorUsers =
      await this.userRepository.findManyWithProfileByIds(doctorIds);
    doctors.push(...doctorUsers);

    const seen = new Set<string>();
    return doctors.filter((d) => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });
  }

  async getUsersWithAccessToDoctor(
    doctorUserId: string,
    ownerId: string,
  ): Promise<User[]> {
    const [usuariosDaConta, vinculos] = await Promise.all([
      this.userRepository.findByOwnerId(ownerId),
      this.userDoctorAccessRepository.findActiveByDoctorUserId(doctorUserId),
    ]);

    const vinculados = new Set(vinculos.map((v) => v.userId));

    return usuariosDaConta.filter((usuario) => {
      if (usuario.status !== UserStatus.ACTIVE) return false;

      const temAcesso =
        usuario.id === doctorUserId ||
        usuario.role === UserRole.ADMIN ||
        vinculados.has(usuario.id);
      if (!temAcesso) return false;

      const permissoes = resolveEffectivePermissions({
        role: usuario.role,
        permissions: usuario.permissions,
        isDoctor: Boolean(usuario.doctorProfile),
        isPhysician: isPhysicianProfile(usuario.doctorProfile),
      });

      return permissoes.includes(Permission.SOLICITACOES);
    });
  }

  async buildSurgeryAccessWhere(
    base: FindOptionsWhere<SurgeryRequest>,
    userId: string,
  ): Promise<FindOptionsWhere<SurgeryRequest>> {
    const [doctorIds, ownerId] = await Promise.all([
      this.getAccessibleDoctorIds(userId),
      this.getOwnerId(userId),
    ]);
    return doctorIds.length > 0
      ? { ...base, ownerId, doctorId: In(doctorIds) }
      : { ...base, ownerId };
  }

  async canAccessDoctor(userId: string, doctorId: string): Promise<boolean> {
    const accessibleIds = await this.getAccessibleDoctorIds(userId);
    return accessibleIds.includes(doctorId);
  }

  async getOwnerId(userId: string): Promise<string> {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException(`Usuário ${userId} não encontrado`);
    return resolverOwnerIdDoUsuario(user);
  }

  async assertSameOwner(userId: string, ownerId: string): Promise<void> {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException(`Usuário ${userId} não encontrado`);
    const effectiveOwnerId = resolverOwnerIdDoUsuario(user);
    if (effectiveOwnerId !== ownerId) {
      throw new ForbiddenException(
        'Acesso negado: recurso pertence a outra clínica.',
      );
    }
  }

  async assertCanAccessDoctorResource(
    userId: string,
    ownerId: string,
    doctorId: string,
  ): Promise<void> {
    await this.assertSameOwner(userId, ownerId);
    if (!(await this.canAccessDoctor(userId, doctorId))) {
      throw new ForbiddenException(
        'Acesso negado: você não tem acesso aos dados deste médico.',
      );
    }
  }

  async assertIsDoctor(userId: string): Promise<void> {
    const user = await this.userRepository.findOneWithProfile({ id: userId });
    if (!user?.doctorProfile) {
      throw new ForbiddenException(
        'Apenas médicos podem realizar esta operação.',
      );
    }
  }

  async assertIsPhysician(
    userId: string,
    mensagem = 'Apenas médicos (CRM) podem realizar esta operação.',
  ): Promise<void> {
    const user = await this.userRepository.findOneWithProfile({ id: userId });
    if (!isPhysicianProfile(user?.doctorProfile)) {
      throw new ForbiddenException(mensagem);
    }
  }

  async assertIsPhysicianWithRegistry(
    userId: string,
    mensagem: string,
    acao: string,
  ): Promise<void> {
    const user = await this.userRepository.findOneWithProfile({ id: userId });
    if (!isPhysicianProfile(user?.doctorProfile)) {
      throw new ForbiddenException(mensagem);
    }
    this.assertRegistroCompleto(user, acao);
  }

  async canIndicateSurgery(userId: string): Promise<boolean> {
    const user = await this.userRepository.findOneWithProfile({ id: userId });
    return (
      isPhysicianProfile(user?.doctorProfile) &&
      hasCouncilRegistry(user?.doctorProfile)
    );
  }

  async assertCanIssueClinicalDocuments(
    userId: string,
    opcoes: { mensagem?: string } = {},
  ): Promise<void> {
    const {
      mensagem = 'Apenas médicos (CRM) e dentistas (CRO) podem emitir receita, atestado e pedido de exame.',
    } = opcoes;
    const user = await this.userRepository.findOneWithProfile({ id: userId });
    if (!isClinicalDocumentIssuerProfile(user?.doctorProfile)) {
      throw new ForbiddenException(mensagem);
    }
  }

  private assertRegistroCompleto(
    user: {
      name?: string | null;
      doctorProfile?: {
        council?: string | null;
        crm?: string | null;
        crmState?: string | null;
      } | null;
    } | null,
    acao: string,
  ): void {
    if (hasCouncilRegistry(user?.doctorProfile)) return;
    const conselho = user?.doctorProfile?.council || 'CRM';
    throw new BadRequestException(
      `Preencha o número e a UF do ${conselho} de ${user?.name ?? 'quem assina'} em Colaboradores antes de ${acao}.`,
    );
  }

  async getEffectivePermissions(userId: string): Promise<Permission[]> {
    const user = await this.userRepository.findOneWithProfile({ id: userId });
    if (!user) return [];

    return resolveEffectivePermissions({
      role: user.role,
      permissions: user.permissions,
      isDoctor: !!user.doctorProfile,
      isPhysician: isPhysicianProfile(user.doctorProfile),
    });
  }

  async resolveDefaultDoctorId(userId: string): Promise<string> {
    const accessibleIds = await this.getAccessibleDoctorIds(userId);
    if (accessibleIds.includes(userId)) return userId;
    if (accessibleIds.length === 0) {
      throw new ForbiddenException(
        'Nenhum médico acessível para esta operação.',
      );
    }
    return accessibleIds[0];
  }

  async getAccountId(userId: string): Promise<string> {
    return this.getOwnerId(userId);
  }
}
