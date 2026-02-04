import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { TeamMember } from '../entities/team-member.entity';

@Injectable()
export class TeamMemberRepository extends Repository<TeamMember> {
  constructor(private dataSource: DataSource) {
    super(TeamMember, dataSource.createEntityManager());
  }

  /**
   * Busca todos os membros de equipe de um médico
   */
  async findByDoctorId(doctorId: string): Promise<TeamMember[]> {
    return this.find({
      where: { doctor_id: doctorId },
      relations: ['collaborator'],
    });
  }

  /**
   * Busca o vínculo de um colaborador (primeiro encontrado)
   */
  async findByCollaboratorId(
    collaboratorId: string,
  ): Promise<TeamMember | null> {
    return this.findOne({
      where: { collaborator_id: collaboratorId },
      relations: ['doctor'],
    });
  }

  /**
   * Busca um vínculo específico entre médico e colaborador
   */
  async findByDoctorAndCollaborator(
    doctorId: string,
    collaboratorId: string,
  ): Promise<TeamMember | null> {
    return this.findOne({
      where: {
        doctor_id: doctorId,
        collaborator_id: collaboratorId,
      },
    });
  }
}
