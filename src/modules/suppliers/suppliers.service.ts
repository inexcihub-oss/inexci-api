import { Injectable } from '@nestjs/common';
import { FindManySupplierDto } from './dto/find-many-supplier.dto';
import { SupplierRepository } from 'src/database/repositories/supplier.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
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
  ) {}

  async findAll(query: FindManySupplierDto, userId: number) {
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
    let doctorId: number;

    if (user.role === UserRole.DOCTOR) {
      const doctorProfile =
        await this.doctorProfileRepository.findByUserId(userId);
      doctorId = doctorProfile?.id;
    } else if (user.role === UserRole.COLLABORATOR) {
      // TODO: Implementar lógica para obter o doctor do colaborador via TeamMember
      return { total: 0, records: [] };
    }

    if (!doctorId) {
      return { total: 0, records: [] };
    }

    // Buscar fornecedores globais + específicos do médico
    const where: FindOptionsWhere<Supplier>[] = [
      { is_global: true },
      { doctor_id: doctorId },
    ];

    const [total, records] = await Promise.all([
      this.supplierRepository.total(where),
      this.supplierRepository.findMany(where, query.skip, query.take),
    ]);

    return { total, records };
  }
}
