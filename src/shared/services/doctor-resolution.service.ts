import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { UserRepository } from 'src/database/repositories/user.repository';
import { isPhysicianProfile } from 'src/database/entities/doctor-profile.entity';

@Injectable()
export class DoctorResolutionService {
  private readonly logger = new Logger(DoctorResolutionService.name);

  constructor(
    private readonly accessControlService: AccessControlService,
    private readonly userRepository: UserRepository,
  ) {}

  async resolveDoctorId(
    userId: string,
    doctorIdFromPayload?: string,
  ): Promise<string> {
    if (doctorIdFromPayload) {
      const doctorIds =
        await this.accessControlService.getAccessibleDoctorIds(userId);
      if (!doctorIds.includes(doctorIdFromPayload)) {
        throw new ForbiddenException(
          'Você não tem permissão para criar solicitações para este médico.',
        );
      }
      await this.accessControlService.assertIsPhysician(
        doctorIdFromPayload,
        'Solicitação cirúrgica só pode ser criada em nome de um médico (CRM).',
      );
      return doctorIdFromPayload;
    }

    const user = await this.userRepository.findOneWithProfile({ id: userId });
    if (isPhysicianProfile(user?.doctorProfile)) return user!.id;

    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);
    const perfis =
      await this.userRepository.findManyWithProfileByIds(doctorIds);
    const medicos = new Set(
      perfis
        .filter((u) => isPhysicianProfile(u.doctorProfile))
        .map((u) => u.id),
    );
    const primeiro = doctorIds.find((id) => medicos.has(id));
    if (!primeiro) {
      throw new ForbiddenException(
        'Nenhum médico (CRM) acessível encontrado para este usuário.',
      );
    }
    return primeiro;
  }
}
