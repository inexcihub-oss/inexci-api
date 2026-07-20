import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FindOptionsWhere, In } from 'typeorm';
import { UserRepository } from '../../database/repositories/user.repository';
import { DoctorProfileRepository } from '../../database/repositories/doctor-profile.repository';
import { UserDoctorAccessRepository } from '../../database/repositories/user-doctor-access.repository';
import { User, UserRole } from '../../database/entities/user.entity';
import { SurgeryRequest } from '../../database/entities/surgery-request.entity';

/**
 * AccessControlService — centraliza toda a lógica de tenant isolation e
 * controle de acesso baseado em médico.
 *
 * Regras gerais:
 * - Toda informação no sistema é particionada por `ownerId` (clínica/conta).
 * - Admin enxerga apenas dados do próprio `ownerId`.
 * - Médico enxerga as próprias solicitações + as dos médicos vinculados via
 *   `user_doctor_access`.
 * - Colaborador (sem doctorProfile) só enxerga dados dos médicos vinculados.
 *
 * Todo service que filtra por `doctorId`/`ownerId` deve usar este service.
 */
/**
 * TTL do cache de acesso: janela de staleness aceitável (segurança).
 * `invalidateAccessibleDoctors` já é chamado nas mutações de vínculo
 * (`user_doctor_access`), então esse TTL só cobre o intervalo entre a
 * mutação e a invalidação explícita — 90s reduz round-trips repetidos
 * (chamado 3-5x por request) sem abrir uma janela de staleness relevante.
 */
const ACCESSIBLE_DOCTORS_CACHE_TTL_MS = 90_000;

@Injectable()
export class AccessControlService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly doctorProfileRepository: DoctorProfileRepository,
    private readonly userDoctorAccessRepository: UserDoctorAccessRepository,
  ) {}

  /**
   * Cache em memória de `getAccessibleDoctorIds`. Chamado 3–5× por requisição
   * (SurgeryRequests, Patients, Reports, Documents) com o mesmo userId. TTL
   * (90s) limita a janela de staleness; mutações de vínculo chamam `invalidate`.
   */
  private readonly accessibleDoctorsCache = new Map<
    string,
    { ids: string[]; expiresAt: number }
  >();

  /**
   * Invalida o cache de acesso de um usuário. Deve ser chamado sempre que um
   * vínculo `user_doctor_access` do usuário for criado/reativado/desativado.
   */
  invalidateAccessibleDoctors(userId: string): void {
    this.accessibleDoctorsCache.delete(userId);
  }

  /**
   * Retorna os IDs de médicos cujos dados o usuário pode ver.
   *
   * - Admin: todos os médicos da própria clínica (mesmo ownerId)
   * - Médico: ele mesmo + médicos vinculados via user_doctor_access
   * - Colaborador: apenas médicos vinculados via user_doctor_access
   *
   * Usado por: SurgeryRequests, Patients, Reports, Documents.
   */
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

  /**
   * Retorna os médicos disponíveis para criação de solicitação.
   *
   * - Admin: todos os médicos da clínica (com dados completos)
   * - Outros: mesmo que getAccessibleDoctorIds, mas retorna User[] com doctorProfile
   */
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
    // Carga única em vez de um findOneWithProfile por vínculo (N+1).
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

  /**
   * Monta um WHERE **fail-closed** escopado por tenant para `SurgeryRequest`.
   *
   * SEMPRE inclui `ownerId` (clínica do usuário) e, quando há médicos
   * acessíveis, restringe também por `doctorId`. Nunca cai em um WHERE sem
   * escopo de tenant — evita o IDOR cross-tenant (V1) que existia quando
   * `doctorIds` vinha vazio e o filtro era simplesmente removido.
   */
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

  /**
   * Verifica se o userId pode acessar uma entidade com o doctorId fornecido.
   * Usado para validação pontual (ex: findOne de uma solicitação específica).
   */
  async canAccessDoctor(userId: string, doctorId: string): Promise<boolean> {
    const accessibleIds = await this.getAccessibleDoctorIds(userId);
    return accessibleIds.includes(doctorId);
  }

  /**
   * Retorna o ownerId da clínica do usuário (raiz do tenant).
   * Para Admins, ownerId === self.id.
   * Para colaboradores e médicos, ownerId é o id do Admin que criou a conta.
   */
  async getOwnerId(userId: string): Promise<string> {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException(`Usuário ${userId} não encontrado`);
    return user.ownerId ?? user.adminId ?? user.id;
  }

  /**
   * Garante que o usuário pertence à clínica do `ownerId` informado.
   * Lança ForbiddenException caso contrário.
   */
  async assertSameOwner(userId: string, ownerId: string): Promise<void> {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException(`Usuário ${userId} não encontrado`);
    const effectiveOwnerId = user.ownerId ?? user.adminId ?? user.id;
    if (effectiveOwnerId !== ownerId) {
      throw new ForbiddenException(
        'Acesso negado: recurso pertence a outra clínica.',
      );
    }
  }

  /**
   * Resolve o médico padrão para uma operação de criação que exige doctorId
   * (ex: criar paciente, template, default document).
   *
   * - Se o usuário é médico, retorna o próprio id.
   * - Caso contrário, retorna o primeiro médico acessível.
   * - Lança ForbiddenException se não houver nenhum.
   */
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

  /**
   * @deprecated use `getOwnerId` em vez de `getAccountId`.
   */
  async getAccountId(userId: string): Promise<string> {
    return this.getOwnerId(userId);
  }
}
