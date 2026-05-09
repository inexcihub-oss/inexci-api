import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { UserRepository } from 'src/database/repositories/user.repository';

/**
 * Service responsável por resolver o doctorId para operações de escrita.
 *
 * Centraliza a lógica de identificação do médico responsável,
 * eliminando duplicação entre services de criação/atualização.
 */
@Injectable()
export class DoctorResolutionService {
  private readonly logger = new Logger(DoctorResolutionService.name);

  constructor(
    private readonly accessControlService: AccessControlService,
    private readonly userRepository: UserRepository,
  ) {}

  /**
   * Resolve o doctorId para operações de escrita.
   * - Se doctorIdFromPayload fornecido: valida acesso e retorna
   * - Se usuário é médico (tem doctorProfile): retorna user.id
   * - Caso contrário: retorna o primeiro médico acessível
   */
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
      return doctorIdFromPayload;
    }

    const user = await this.userRepository.findOneWithProfile({ id: userId });
    if (user?.doctorProfile) return user.id;

    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);
    if (doctorIds.length === 0) {
      throw new ForbiddenException(
        'Nenhum médico acessível encontrado para este usuário.',
      );
    }
    return doctorIds[0];
  }
}
