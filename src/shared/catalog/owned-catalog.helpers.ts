import {
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DeepPartial, FindOptionsWhere, In, ObjectLiteral } from 'typeorm';
import { BaseRepository } from 'src/database/repositories/base.repository';
import {
  OwnedCatalogRecord,
  OwnedCatalogRepository,
} from 'src/database/repositories/owned-catalog.repository';
import { violouIndice } from 'src/database/repositories/unique-violation.util';
import { AccessControlService } from 'src/shared/services/access-control.service';

type OwnedRecord = ObjectLiteral & { id: string; ownerId: string };

export async function findOwnedOrFail<T extends OwnedRecord>(
  repository: Pick<BaseRepository<T>, 'findOne'>,
  accessControl: AccessControlService,
  id: string,
  userId: string,
  notFoundMessage: string,
): Promise<T> {
  const registro = await repository.findOne({ id } as FindOptionsWhere<T>);
  if (!registro) throw new NotFoundException(notFoundMessage);
  await accessControl.assertSameOwner(userId, registro.ownerId);
  return registro;
}

export async function resolveCatalogOwnerId(
  accessControl: AccessControlService,
  userId: string,
): Promise<string> {
  const ownerId = await accessControl.getOwnerId(userId);
  if (!ownerId) {
    throw new ForbiddenException('Usuário sem clínica vinculada.');
  }
  return ownerId;
}

export async function bulkDeleteOwned<T extends OwnedRecord>(params: {
  repository: Pick<BaseRepository<T>, 'findMany' | 'bulkSoftDelete'>;
  ids: string[];
  ownerId: string;
  notFoundMessage: string;
  guard?: (registro: T) => void;
}): Promise<{ deleted: number }> {
  const uniqueIds = [...new Set(params.ids)];
  const registros = await params.repository.findMany({
    id: In(uniqueIds),
    ownerId: params.ownerId,
  } as FindOptionsWhere<T>);

  if (registros.length !== uniqueIds.length) {
    throw new NotFoundException(params.notFoundMessage);
  }

  if (params.guard) registros.forEach(params.guard);

  await params.repository.bulkSoftDelete(uniqueIds);
  return { deleted: uniqueIds.length };
}

export async function createOrRestoreByName<
  T extends ObjectLiteral & OwnedCatalogRecord,
>(params: {
  repository: OwnedCatalogRepository<T>;
  ownerId: string;
  data: DeepPartial<T> & { name: string };
  conflictMessage: (nome: string) => string;
  uniqueIndex?: string;
  logger?: Logger;
}): Promise<T> {
  const { repository, ownerId, data } = params;
  const conflito = () =>
    new ConflictException(params.conflictMessage(data.name.trim()));

  const existente = await repository.findByNameIncludingDeleted(
    ownerId,
    data.name,
  );

  if (existente && !existente.deletedAt) throw conflito();

  try {
    if (existente?.deletedAt) {
      await repository.restore(existente.id);
      const restaurado = await repository.update(existente.id, data);
      params.logger?.log(
        `Cadastro restaurado após soft delete: id=${existente.id}`,
      );
      return restaurado!;
    }

    return await repository.create({ ...data, ownerId });
  } catch (erro) {
    if (params.uniqueIndex && violouIndice(erro, params.uniqueIndex)) {
      params.logger?.warn(
        `Cadastro concorrente com o mesmo nome barrado por ${params.uniqueIndex}: ownerId=${ownerId}`,
      );
      throw conflito();
    }
    throw erro;
  }
}

export async function updateWithUniqueName<
  T extends ObjectLiteral & { id: string },
>(params: {
  repository: Pick<BaseRepository<T>, 'update'>;
  id: string;
  data: DeepPartial<T> & { name?: string };
  uniqueIndex: string;
  conflictMessage: (nome: string) => string;
}): Promise<T> {
  try {
    return (await params.repository.update(params.id, params.data))!;
  } catch (erro) {
    if (violouIndice(erro, params.uniqueIndex)) {
      throw new ConflictException(
        params.conflictMessage((params.data.name ?? '').trim()),
      );
    }
    throw erro;
  }
}
