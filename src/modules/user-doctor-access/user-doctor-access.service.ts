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

  private async validateUserInAccount(userId: string, ownerId: string) {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException(`Usuário ${userId} não encontrado`);
    if (user.ownerId !== ownerId) {
      throw new ForbiddenException(
        'O usuário não pertence à mesma conta do admin',
      );
    }
    return user;
  }

  private async validateDoctorUser(doctorUserId: string, ownerId: string) {
    const doctorUser = await this.validateUserInAccount(doctorUserId, ownerId);
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
    await this.validateUserInAccount(userId, admin.ownerId);

    const accesses =
      await this.userDoctorAccessRepository.findAllByUserId(userId);
    return { records: accesses };
  }

  /**
   * PUT /user-doctor-access/:userId
   * Redefine a lista completa de vínculos (transação atômica).
   */
  async setAccess(userId: string, doctorUserIds: string[], adminId: string) {
    const admin = await this.validateAdmin(adminId);
    await this.validateUserInAccount(userId, admin.ownerId);

    // Validar todos os doctorUserIds
    for (const doctorId of doctorUserIds) {
      await this.validateDoctorUser(doctorId, admin.ownerId);
    }

    return executeInTransaction(
      this.dataSource,
      async (_manager) => {
        // Buscar vínculos existentes
        const existing =
          await this.userDoctorAccessRepository.findAllByUserId(userId);

        // Desativar vínculos que não estão na nova lista
        for (const access of existing) {
          if (!doctorUserIds.includes(access.doctorUserId)) {
            await this.userDoctorAccessRepository.deactivate(
              userId,
              access.doctorUserId,
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
}
