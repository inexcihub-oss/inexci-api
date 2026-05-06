import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { executeInTransaction } from 'src/shared/utils/transaction.util';
import { UserRepository } from 'src/database/repositories/user.repository';
import { UserDoctorAccessRepository } from 'src/database/repositories/user-doctor-access.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { UserRole } from 'src/database/entities/user.entity';
import { UserDoctorAccessStatus } from 'src/database/entities/user-doctor-access.entity';

@Injectable()
export class UserDoctorAccessService {
  private readonly logger = new Logger(UserDoctorAccessService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly userRepository: UserRepository,
    private readonly userDoctorAccessRepository: UserDoctorAccessRepository,
    private readonly doctorProfileRepository: DoctorProfileRepository,
  ) {}

  /**
   * Valida que o admin tem permissão e que userId/doctorUserId pertencem à mesma conta.
   */
  private async validateAdmin(adminId: string) {
    const admin = await this.userRepository.findOne({ id: adminId });
    if (!admin) throw new NotFoundException('Admin não encontrado');
    if (admin.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Apenas admins podem gerenciar vínculos de acesso',
      );
    }
    return admin;
  }

  private async validateUserInAccount(userId: string, accountId: string) {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException(`Usuário ${userId} não encontrado`);
    if (user.account_id !== accountId) {
      throw new ForbiddenException(
        'O usuário não pertence à mesma conta do admin',
      );
    }
    return user;
  }

  private async validateDoctorUser(doctorUserId: string, accountId: string) {
    const doctorUser = await this.validateUserInAccount(
      doctorUserId,
      accountId,
    );
    const hasProfile =
      await this.doctorProfileRepository.existsByUserId(doctorUserId);
    if (!hasProfile) {
      throw new BadRequestException(
        `O usuário ${doctorUserId} não possui perfil médico`,
      );
    }
    return doctorUser;
  }

  /**
   * GET /user-doctor-access?userId=
   * Retorna vínculos de um collaborator.
   */
  async getAccessForUser(userId: string, adminId: string) {
    const admin = await this.validateAdmin(adminId);
    await this.validateUserInAccount(userId, admin.account_id);

    const accesses =
      await this.userDoctorAccessRepository.findAllByUserId(userId);
    return { records: accesses };
  }

  /**
   * GET /user-doctor-access/all
   * Todos os vínculos da conta, agrupados por collaborator.
   */
  async getAccessList(adminId: string) {
    const admin = await this.validateAdmin(adminId);

    const accesses = await this.userDoctorAccessRepository.findByAccountId(
      admin.account_id,
    );
    return { records: accesses };
  }

  /**
   * PUT /user-doctor-access/:userId
   * Redefine a lista completa de vínculos (transação atômica).
   */
  async setAccess(userId: string, doctorUserIds: string[], adminId: string) {
    const admin = await this.validateAdmin(adminId);
    await this.validateUserInAccount(userId, admin.account_id);

    // Validar todos os doctorUserIds
    for (const doctorId of doctorUserIds) {
      await this.validateDoctorUser(doctorId, admin.account_id);
    }

    return executeInTransaction(
      this.dataSource,
      async (_manager) => {
        // Buscar vínculos existentes
        const existing =
          await this.userDoctorAccessRepository.findAllByUserId(userId);

        // Desativar vínculos que não estão na nova lista
        for (const access of existing) {
          if (!doctorUserIds.includes(access.doctor_user_id)) {
            await this.userDoctorAccessRepository.deactivate(
              userId,
              access.doctor_user_id,
            );
          }
        }

        // Criar/ativar vínculos novos
        for (const doctorId of doctorUserIds) {
          await this.userDoctorAccessRepository.upsert({
            userId: userId,
            doctorUserId: doctorId,
            status: UserDoctorAccessStatus.ACTIVE,
            createdById: adminId,
          });
        }

        // Retornar estado final
        const updated =
          await this.userDoctorAccessRepository.findAllByUserId(userId);
        return { records: updated };
      },
      { logger: this.logger, operationName: 'setAccess' },
    );
  }

  /**
   * POST /user-doctor-access
   * Adiciona/ativa vínculo individual.
   */
  async addAccess(userId: string, doctorUserId: string, adminId: string) {
    const admin = await this.validateAdmin(adminId);
    await this.validateUserInAccount(userId, admin.account_id);
    await this.validateDoctorUser(doctorUserId, admin.account_id);

    const result = await this.userDoctorAccessRepository.upsert({
      userId: userId,
      doctorUserId: doctorUserId,
      status: UserDoctorAccessStatus.ACTIVE,
      createdById: adminId,
    });

    return result;
  }

  /**
   * PATCH /user-doctor-access/:userId/:doctorUserId/deactivate
   * Desativa vínculo individual (soft-delete).
   */
  async deactivateAccess(
    userId: string,
    doctorUserId: string,
    adminId: string,
  ) {
    const admin = await this.validateAdmin(adminId);
    await this.validateUserInAccount(userId, admin.account_id);

    await this.userDoctorAccessRepository.deactivate(userId, doctorUserId);
    return { message: 'Vínculo desativado com sucesso' };
  }
}
