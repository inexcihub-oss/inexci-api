import { Injectable } from '@nestjs/common';
import { UserRepository } from '../../database/repositories/user.repository';
import { DoctorProfileRepository } from '../../database/repositories/doctor-profile.repository';
import { UserDoctorAccessRepository } from '../../database/repositories/user-doctor-access.repository';
import { User, UserRole } from '../../database/entities/user.entity';

/**
 * AccessControlService — centraliza toda a lógica de acesso baseada em doctor_id.
 *
 * Substitui os 4+ getDoctorId() diferentes que existiam nos services.
 * Todo service que filtra por doctor_id deve usar este service.
 */
@Injectable()
export class AccessControlService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly doctorProfileRepository: DoctorProfileRepository,
    private readonly userDoctorAccessRepository: UserDoctorAccessRepository,
  ) {}

  /**
   * Retorna os IDs de médicos cujos dados o usuário pode ver.
   *
   * - Admin: todos os médicos da conta
   * - Médico: ele mesmo + médicos vinculados via user_doctor_access
   * - Collaborator: apenas médicos vinculados via user_doctor_access
   *
   * Usado por: SurgeryRequests, Patients, Hospitals, HealthPlans, Suppliers, Reports, Documents
   */
  async getAccessibleDoctorIds(userId: string): Promise<string[]> {
    const user = await this.userRepository.findOneWithProfile({ id: userId });
    if (!user) return [];

    if (user.role === UserRole.ADMIN) {
      // Admin vê todos os médicos da conta
      const doctors = await this.userRepository.findDoctorsByAccountId(
        user.account_id,
      );
      return doctors.map((d) => d.id);
    }

    const ids: string[] = [];

    // Se é médico, acessa as próprias solicitações
    if (user.doctor_profile) {
      ids.push(user.id);
    }

    // Vínculos ativos
    const accesses =
      await this.userDoctorAccessRepository.findActiveByUserId(userId);
    ids.push(...accesses.map((a) => a.doctor_user_id));

    // Deduplica
    return [...new Set(ids)];
  }

  /**
   * Retorna os médicos disponíveis para criação de solicitação.
   *
   * - Admin: todos os médicos da conta (com dados completos)
   * - Outros: mesmo que getAccessibleDoctorIds, mas retorna User[] com doctor_profile
   */
  async getAvailableDoctorsForCreation(userId: string): Promise<User[]> {
    const user = await this.userRepository.findOneWithProfile({ id: userId });
    if (!user) return [];

    if (user.role === UserRole.ADMIN) {
      return this.userRepository.findDoctorsByAccountId(user.account_id);
    }

    const doctors: User[] = [];

    // Se é médico, inclui ele mesmo
    if (user.doctor_profile) {
      doctors.push(user);
    }

    // Vínculos ativos — buscar os médicos completos
    const accesses =
      await this.userDoctorAccessRepository.findActiveByUserId(userId);
    for (const access of accesses) {
      if (access.doctor) {
        // Já carregado pela relation
        const doctorUser = await this.userRepository.findOneWithProfile({
          id: access.doctor_user_id,
        });
        if (doctorUser) {
          doctors.push(doctorUser);
        }
      }
    }

    // Deduplica por ID
    const seen = new Set<string>();
    return doctors.filter((d) => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });
  }

  /**
   * Verifica se o userId pode acessar uma entidade com o doctor_id fornecido.
   * Usado para validação pontual (ex: findOne de uma solicitação específica).
   */
  async canAccessDoctor(userId: string, doctorId: string): Promise<boolean> {
    const accessibleIds = await this.getAccessibleDoctorIds(userId);
    return accessibleIds.includes(doctorId);
  }

  /**
   * Retorna o account_id do usuário (para queries de isolamento).
   */
  async getAccountId(userId: string): Promise<string> {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new Error(`User ${userId} not found`);
    return user.account_id;
  }
}
