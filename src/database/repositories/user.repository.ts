import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  FindOptionsWhere,
  QueryDeepPartialEntity,
  In,
} from 'typeorm';
import { User, UserRole } from '../entities/user.entity';
import { BaseRepository } from './base.repository';
import { OnboardingState } from '../../modules/onboarding/onboarding.types';
import {
  PatientNotificationKind,
  PatientNotificationSettings,
  resolvePatientNotificationSettings,
} from '../../common/patient-notification-settings';

@Global()
@Injectable()
export class UserRepository extends BaseRepository<User> {
  constructor(
    @InjectRepository(User)
    repository: Repository<User>,
  ) {
    super(repository);
  }

  async total(where: FindOptionsWhere<User> | FindOptionsWhere<User>[]) {
    return await this.repository.count({ where });
  }

  async findOne(
    where: FindOptionsWhere<User> | FindOptionsWhere<User>[],
    selectPassword = false,
  ) {
    return await this.repository.findOne({
      where,
      relations: ['doctorProfile'],
      select: {
        id: true,
        role: true,
        status: true,
        email: true,
        name: true,
        phone: true,
        cpf: true,
        gender: true,
        birthDate: true,
        avatarUrl: true,
        emailVerified: true,
        emailVerifiedAt: true,
        password: selectPassword,
        ownerId: true,
        adminId: true,
        cep: true,
        address: true,
        addressNumber: true,
        addressComplement: true,
        city: true,
        state: true,
        privacyPolicyAcceptedAt: true,
        termsOfUseAcceptedAt: true,
        aiConsentAcceptedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findOneWithProfile(
    where: FindOptionsWhere<User> | FindOptionsWhere<User>[],
  ) {
    return await this.repository.findOne({
      where,
      relations: ['doctorProfile'],
      select: {
        id: true,
        role: true,
        status: true,
        email: true,
        name: true,
        phone: true,
        cpf: true,
        gender: true,
        birthDate: true,
        avatarUrl: true,
        emailVerified: true,
        privacyPolicyAcceptedAt: true,
        termsOfUseAcceptedAt: true,
        aiConsentAcceptedAt: true,
        ownerId: true,
        adminId: true,
        isPlatformAdmin: true,
        permissions: true,
        cep: true,
        address: true,
        addressNumber: true,
        addressComplement: true,
        city: true,
        state: true,
        createdAt: true,
        updatedAt: true,
        onboardingState: true,
      },
    });
  }

  async findManyWithProfileByIds(ids: string[]): Promise<User[]> {
    if (ids.length === 0) return [];
    return await this.repository.find({
      where: { id: In(ids) },
      relations: ['doctorProfile'],
      select: {
        id: true,
        role: true,
        status: true,
        email: true,
        name: true,
        phone: true,
        cpf: true,
        gender: true,
        birthDate: true,
        avatarUrl: true,
        emailVerified: true,
        privacyPolicyAcceptedAt: true,
        termsOfUseAcceptedAt: true,
        aiConsentAcceptedAt: true,
        ownerId: true,
        adminId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findMany(
    where: FindOptionsWhere<User> | FindOptionsWhere<User>[],
    skip: number,
    take: number,
  ) {
    return await this.repository.find({
      where,
      skip,
      take,
      relations: ['doctorProfile'],
      select: {
        id: true,
        role: true,
        status: true,
        email: true,
        name: true,
        phone: true,
        avatarUrl: true,
        ownerId: true,
        adminId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findByOwnerId(
    ownerId: string,
    skip?: number,
    take?: number,
  ): Promise<User[]> {
    return await this.repository.find({
      where: { ownerId },
      skip,
      take,
      relations: ['doctorProfile'],
      order: { name: 'ASC' },
    });
  }

  async findDoctorsByOwnerId(ownerId: string): Promise<User[]> {
    return await this.repository
      .createQueryBuilder('user')
      .innerJoinAndSelect('user.doctorProfile', 'dp')
      .where('user.ownerId = :ownerId', { ownerId })
      .orderBy('user.name', 'ASC')
      .getMany();
  }

  async create(data: Partial<User>) {
    const user = this.repository.create(data);
    return await this.repository.save(user);
  }

  async update(id: string, data: Partial<User>) {
    await this.repository.update(id, data as QueryDeepPartialEntity<User>);
    return await this.findOne({ id });
  }

  findOneByPhone(phone: string): Promise<User | null> {
    return this.findOneWithProfile({ phone });
  }

  async findOneWithDeleted(
    where: FindOptionsWhere<User>,
  ): Promise<User | null> {
    return await this.repository.findOne({ where, withDeleted: true });
  }

  async getPatientNotificationSettings(
    ownerId: string,
  ): Promise<PatientNotificationSettings> {
    const owner = await this.repository.findOne({
      where: { id: ownerId },
      select: { id: true, patientNotificationSettings: true },
    });
    return resolvePatientNotificationSettings(
      owner?.patientNotificationSettings,
    );
  }

  async isPatientNotificationEnabled(
    ownerId: string,
    kind: PatientNotificationKind,
  ): Promise<boolean> {
    const settings = await this.getPatientNotificationSettings(ownerId);
    return settings[kind];
  }

  async updatePatientNotificationSettings(
    ownerId: string,
    patch: Partial<PatientNotificationSettings>,
  ): Promise<PatientNotificationSettings> {
    const atual = await this.getPatientNotificationSettings(ownerId);
    const proximo = resolvePatientNotificationSettings({ ...atual, ...patch });
    await this.repository.update(ownerId, {
      patientNotificationSettings: proximo,
    } as QueryDeepPartialEntity<User>);
    return proximo;
  }

  async mutateOnboardingStateLocked(
    userId: string,
    mutate: (atual: OnboardingState | null) => OnboardingState,
  ): Promise<OnboardingState | null> {
    return this.repository.manager.transaction(async (manager) => {
      const user = await manager.findOne(User, {
        where: { id: userId },
        select: ['id', 'onboardingState'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) return null;

      const proximo = mutate(user.onboardingState);
      await manager.update(User, userId, { onboardingState: proximo });
      return proximo;
    });
  }

  findCollaboratorsByIds(
    ids: string[],
    ownerId: string,
  ): Promise<Array<Pick<User, 'id' | 'email' | 'ownerId' | 'phone'>>> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.repository.find({
      where: { id: In(ids), ownerId, role: UserRole.COLLABORATOR },
      select: { id: true, email: true, ownerId: true, phone: true },
    });
  }
}
