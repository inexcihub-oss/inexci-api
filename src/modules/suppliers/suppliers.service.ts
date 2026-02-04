import { Injectable } from '@nestjs/common';
import { FindManySupplierDto } from './dto/find-many-supplier.dto';
import { SupplierRepository } from 'src/database/repositories/supplier.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { TeamMemberRepository } from 'src/database/repositories/team-member.repository';
import { FindOptionsWhere, In } from 'typeorm';
import { Supplier } from 'src/database/entities/supplier.entity';
import { UserRepository } from 'src/database/repositories/user.repository';
import { UserRole } from 'src/database/entities/user.entity';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly supplierRepository: SupplierRepository,
    private readonly doctorProfileRepository: DoctorProfileRepository,
    private readonly userRepository: UserRepository,
    private readonly teamMemberRepository: TeamMemberRepository,
  ) {}

  async findAll(query: FindManySupplierDto, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });

    if (user.role === UserRole.ADMIN) {
      // Admin pode ver todos os fornecedores
      const [total, records] = await Promise.all([
        this.supplierRepository.total({}),
        this.supplierRepository.findMany({}, query.skip, query.take),
      ]);
      return { total, records };
    }

    // Determinar o doctor_id baseado no role do usuário
    let doctorId: string;

    if (user.role === UserRole.DOCTOR) {
      const doctorProfile =
        await this.doctorProfileRepository.findByUserId(userId);
      doctorId = doctorProfile?.id;
    } else if (user.role === UserRole.COLLABORATOR) {
      // Colaborador acessa fornecedores do médico via TeamMember
      const teamMember =
        await this.teamMemberRepository.findByCollaboratorId(userId);
      if (!teamMember) {
        return { total: 0, records: [] };
      }
      const doctorProfile = await this.doctorProfileRepository.findByUserId(
        teamMember.doctor_id,
      );
      doctorId = doctorProfile?.id;
    }

    if (!doctorId) {
      return { total: 0, records: [] };
    }

    // Buscar apenas fornecedores específicos do médico
    const where: FindOptionsWhere<Supplier> = { doctor_id: doctorId };

    const [total, records] = await Promise.all([
      this.supplierRepository.total(where),
      this.supplierRepository.findMany(where, query.skip, query.take),
    ]);

    return { total, records };
  }
}
