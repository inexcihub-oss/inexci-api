import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { UserRepository } from 'src/database/repositories/user.repository';
import { isPhysicianProfile } from 'src/database/entities/doctor-profile.entity';

/**
 * Service responsável por resolver o doctorId de uma **solicitação cirúrgica**
 * nova (único consumidor: `SurgeryRequestMutationService`).
 *
 * SC é de médico (CRM): o médico resolvido aqui tem que ser médico, não só
 * profissional de saúde. Psicóloga, nutricionista ou enfermagem têm agenda e
 * prontuário, mas não abrem SC — nem em nome próprio, nem por um colaborador.
 */
@Injectable()
export class DoctorResolutionService {
  private readonly logger = new Logger(DoctorResolutionService.name);

  constructor(
    private readonly accessControlService: AccessControlService,
    private readonly userRepository: UserRepository,
  ) {}

  /**
   * Resolve o doctorId para criar uma SC.
   * - `doctorIdFromPayload` informado: valida acesso e que é médico (CRM).
   * - Usuário é médico (CRM): retorna o próprio id.
   * - Caso contrário: o primeiro médico (CRM) acessível.
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
      await this.accessControlService.assertIsPhysician(
        doctorIdFromPayload,
        'Solicitação cirúrgica só pode ser criada em nome de um médico (CRM).',
      );
      return doctorIdFromPayload;
    }

    const user = await this.userRepository.findOneWithProfile({ id: userId });
    if (isPhysicianProfile(user?.doctorProfile)) return user!.id;

    // Mantém a ordem de `getAccessibleDoctorIds` (o primeiro acessível
    // continua sendo o escolhido), pulando quem não é médico.
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
