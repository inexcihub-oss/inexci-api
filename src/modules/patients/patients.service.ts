import {
  BadRequestException,
  Injectable,
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

    const where: FindOptionsWhere<Patient> = { doctor_id: In(doctorIds) };

    const [total, records] = await Promise.all([
      this.patientRepository.total(where),
      this.patientRepository.findMany(where, query.skip, query.take),
    ]);

    return { total, records };
  }

  async create(data: CreatePatientDto, userId: string): Promise<Patient> {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    // doctor_id agora é user.id do médico
    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);
    if (doctorIds.length === 0) {
      throw new BadRequestException(
        'Nenhum médico acessível para criar pacientes.',
      );
    }
    // Priorizar o próprio usuário se ele for médico
    const doctorId = doctorIds.includes(userId) ? userId : doctorIds[0];

    const patient = await this.patientRepository.create({
      doctor_id: doctorId,
      name: data.name,
      phone: data.phone,
      cpf: data.cpf,
      gender: data.gender,
      birth_date: data.birth_date ? new Date(data.birth_date) : undefined,
      health_plan_id: data.health_plan_id,
      health_plan_number: data.health_plan_number,
      health_plan_type: data.health_plan_type,
      email: data.email,
      zip_code: data.zip_code,
      address: data.address,
      address_number: data.address_number,
      address_complement: data.address_complement,
      neighborhood: data.neighborhood,
      city: data.city,
      state: data.state,
      medical_notes: data.medical_notes,
      active: true,
    });

    // Notifica o paciente via WhatsApp (assíncrono — não bloqueia o cadastro)
    if (patient.phone) {
      this.whatsappService.sendPatientWelcome(patient.phone, patient.name);
    }

    return patient;
  }

  async update(id: string, data: UpdatePatientDto): Promise<Patient> {
    const patient = await this.patientRepository.findOne({ id });
    if (!patient) throw new NotFoundException('Paciente não encontrado');

    const updateData: Partial<Patient> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.cpf !== undefined) updateData.cpf = data.cpf;
    if (data.gender !== undefined) updateData.gender = data.gender;
    if (data.birth_date !== undefined)
      updateData.birth_date = new Date(data.birth_date);
    if (data.health_plan_id !== undefined)
      updateData.health_plan_id = data.health_plan_id;
    if (data.health_plan_number !== undefined)
      updateData.health_plan_number = data.health_plan_number;
    if (data.health_plan_type !== undefined)
      updateData.health_plan_type = data.health_plan_type;
    if (data.zip_code !== undefined) updateData.zip_code = data.zip_code;
    if (data.address !== undefined) updateData.address = data.address;
    if (data.address_number !== undefined)
      updateData.address_number = data.address_number;
    if (data.address_complement !== undefined)
      updateData.address_complement = data.address_complement;
    if (data.neighborhood !== undefined)
      updateData.neighborhood = data.neighborhood;
    if (data.city !== undefined) updateData.city = data.city;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.medical_notes !== undefined)
      updateData.medical_notes = data.medical_notes;

    return this.patientRepository.update(id, updateData);
  }

  async delete(id: string): Promise<void> {
    const patient = await this.patientRepository.findOne({ id });
    if (!patient) throw new NotFoundException('Paciente n\u00e3o encontrado');
    await this.patientRepository.delete(id);
  }
}
