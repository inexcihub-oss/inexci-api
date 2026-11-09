import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class AdminLookupRepository extends BaseRepository<User> {
  constructor(@InjectRepository(User) repo: Repository<User>) {
    super(repo);
  }

  async ownersOfUsers(userIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    const rows = await this.repository.find({
      select: { id: true, ownerId: true },
      where: { id: In(ids) },
      withDeleted: true,
    });
    return new Map(
      rows.filter((r) => r.ownerId).map((r) => [r.id, r.ownerId] as const),
    );
  }

  async accountNames(ownerIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(ownerIds)];
    if (ids.length === 0) return new Map();
    const rows = await this.repository.find({
      select: { id: true, name: true },
      where: { id: In(ids) },
      withDeleted: true,
    });
    return new Map(rows.map((r) => [r.id, r.name] as const));
  }
}
