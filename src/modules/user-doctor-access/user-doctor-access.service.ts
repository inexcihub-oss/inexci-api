import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRepository } from 'src/database/repositories/user.repository';
import { UserDoctorAccessRepository } from 'src/database/repositories/user-doctor-access.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { canAdministrate } from 'src/shared/permissions';

@Injectable()
export class UserDoctorAccessService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly userDoctorAccessRepository: UserDoctorAccessRepository,
    private readonly doctorProfileRepository: DoctorProfileRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  private async validateAdmin(adminId: string) {
    const admin = await this.userRepository.findOneWithProfile({
      id: adminId,
    });
    if (!admin) throw new NotFoundException('Admin não encontrado');
    if (!canAdministrate(admin)) {
      throw new ForbiddenException(
        'Apenas quem tem permissão de Administração pode gerenciar vínculos de acesso',
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

  async getAccessForUser(userId: string, adminId: string) {
    const admin = await this.validateAdmin(adminId);
    await this.validateUserInAccount(userId, admin.ownerId);

    const accesses =
      await this.userDoctorAccessRepository.findAllByUserId(userId);
    return { records: accesses };
  }

  async setAccess(userId: string, doctorUserIds: string[], adminId: string) {
    const admin = await this.validateAdmin(adminId);
    await this.validateUserInAccount(userId, admin.ownerId);

    for (const doctorId of doctorUserIds) {
      await this.validateDoctorUser(doctorId, admin.ownerId);
    }

    const records = await this.userDoctorAccessRepository.replaceDoctorsForUser(
      userId,
      doctorUserIds,
      adminId,
    );
    this.accessControlService.invalidateAccessibleDoctors(userId);
    return { records };
  }
}
