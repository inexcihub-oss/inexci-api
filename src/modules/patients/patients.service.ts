import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FindManyPatientDto } from './dto/find-many-patient.dto';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { PatientRepository } from 'src/database/repositories/patient.repository';
import { FindOptionsWhere, In } from 'typeorm';
import { Patient } from 'src/database/entities/patient.entity';
import { UserRepository } from 'src/database/repositories/user.repository';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { AccessControlService } from 'src/shared/services/access-control.service';

@Injectable()
export class PatientsService {
  private readonly logger = new Logger(PatientsService.name);
  constructor(
    private readonly patientRepository: PatientRepository,
    private readonly userRepository: UserRepository,
    private readonly whatsappService: WhatsappService,
    private readonly accessControlService: AccessControlService,
  ) {}

  async findAll(query: FindManyPatientDto, userId: string) {
    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);
    if (doctorIds.length === 0) {
      return { total: 0, records: [] };
    }

    const where: FindOptionsWhere<Patient> = {
      doctorId: In(doctorIds),
    };

    const [total, records] = await Promise.all([
      this.patientRepository.total(where),
      this.patientRepository.findMany(where, query.skip, query.take),
    ]);

    return { total, records };
  }

  async findOne(id: string, userId: string): Promise<Patient> {
    const patient = await this.patientRepository.findOne({ id });
    if (!patient) throw new NotFoundException('Paciente não encontrado');
    await this.accessControlService.assertSameOwner(userId, patient.ownerId);
    return patient;
  }

  async create(data: CreatePatientDto, userId: string): Promise<Patient> {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const doctorId =
      await this.accessControlService.resolveDefaultDoctorId(userId);

    if (!doctorId) {
      throw new BadRequestException(
        'Nenhum médico acessível para criar pacientes.',
      );
    }

    const ownerId = user.ownerId;

    const patient = await this.patientRepository.create({
      doctorId,
      ownerId,
      name: data.name,
      phone: data.phone.trim(),
      cpf: data.cpf,
      gender: data.gender,
      birthDate: data.birthDate ? new Date(data.birthDate) : undefined,
      healthPlanId: data.healthPlanId,
      healthPlanNumber: data.healthPlanNumber,
      healthPlanType: data.healthPlanType,
      email: data.email.trim(),
      zipCode: data.zipCode,
      address: data.address,
      addressNumber: data.addressNumber,
      addressComplement: data.addressComplement,
      neighborhood: data.neighborhood,
      city: data.city,
      state: data.state,
      medicalNotes: data.medicalNotes,
      active: true,
    });

    void this.whatsappService.sendPatientWelcome(patient.phone, patient.name);

    return patient;
  }

  async update(
    id: string,
    data: UpdatePatientDto,
    userId: string,
  ): Promise<Patient> {
    const patient = await this.patientRepository.findOne({ id });
    if (!patient) throw new NotFoundException('Paciente não encontrado');
    await this.accessControlService.assertSameOwner(userId, patient.ownerId);

    const updateData: Partial<Patient> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.phone !== undefined) updateData.phone = data.phone.trim();
    if (data.email !== undefined) updateData.email = data.email.trim();
    if (data.cpf !== undefined) updateData.cpf = data.cpf;
    if (data.gender !== undefined) updateData.gender = data.gender;
    if (data.birthDate !== undefined)
      updateData.birthDate = new Date(data.birthDate);
    if (data.healthPlanId !== undefined)
      updateData.healthPlanId = data.healthPlanId;
    if (data.healthPlanNumber !== undefined)
      updateData.healthPlanNumber = data.healthPlanNumber;
    if (data.healthPlanType !== undefined)
      updateData.healthPlanType = data.healthPlanType;
    if (data.zipCode !== undefined) updateData.zipCode = data.zipCode;
    if (data.address !== undefined) updateData.address = data.address;
    if (data.addressNumber !== undefined)
      updateData.addressNumber = data.addressNumber;
    if (data.addressComplement !== undefined)
      updateData.addressComplement = data.addressComplement;
    if (data.neighborhood !== undefined)
      updateData.neighborhood = data.neighborhood;
    if (data.city !== undefined) updateData.city = data.city;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.medicalNotes !== undefined)
      updateData.medicalNotes = data.medicalNotes;

    return this.patientRepository.update(id, updateData);
  }

  async delete(id: string, userId: string): Promise<void> {
    const patient = await this.patientRepository.findOne({ id });
    if (!patient) throw new NotFoundException('Paciente não encontrado');
    await this.accessControlService.assertSameOwner(userId, patient.ownerId);
    await this.patientRepository.delete(id);
  }
}
