import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  FindOptionsWhere,
  QueryDeepPartialEntity,
  In,
} from 'typeorm';
import { User } from '../entities/user.entity';
import { BaseRepository } from './base.repository';

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
      },
    });
  }

  /**
   * Carrega vários usuários (com doctorProfile) em uma única query (WHERE id IN),
   * evitando o N+1 de buscar um a um. Mesmo shape de select do findOneWithProfile.
   */
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
      // Sem CPF, gênero e nascimento de propósito: `GET /users` é o diretório
      // do staff, liberado a qualquer área autenticada, e nenhum consumidor
      // usa esses três (a camada de IA lê só `id`/`name`). Quem precisa do
      // cadastro completo de uma pessoa usa a rota por id.
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

  /**
   * Lookup por telefone usado exclusivamente pelo preflight do assistente do
   * WhatsApp (`PhoneNormalizerService`/`MessageProcessorService`). Usa
   * `findOneWithProfile` (não `findOne`) DE PROPÓSITO: `findOne` tem um
   * `select` de ~26 colunas que **não inclui `permissions`** — com `select`
   * parcial o TypeORM devolve a propriedade como `undefined`, então o
   * orquestrador de IA calculava a permissão efetiva do usuário sobre um
   * array vazio (`resolveEffectivePermissions({ permissions: undefined })`),
   * recusando todas as tools com `requiredPermission` para qualquer
   * colaborador não-médico. Ampliar o `select` de `findOne` para incluir
   * `permissions` NÃO é a correção certa: `findOne` tem dezenas de
   * chamadores fora deste módulo (ex.: `UsersService.findOne`, que devolve o
   * resultado direto numa resposta HTTP sem filtrar `permissions`/
   * `isPlatformAdmin`) — vazaria a coluna crua em rotas que não são
   * gated por `ADMINISTRACAO`. `findOneWithProfile` já filtra esse uso a um
   * conjunto controlado de chamadores que sabem descartar o campo quando
   * necessário (ver `UsersService.getProfile`/`findCollaboratorById`).
   */
  findOneByPhone(phone: string): Promise<User | null> {
    return this.findOneWithProfile({ phone });
  }

  async findOneWithDeleted(
    where: FindOptionsWhere<User>,
  ): Promise<User | null> {
    return await this.repository.findOne({ where, withDeleted: true });
  }
}
