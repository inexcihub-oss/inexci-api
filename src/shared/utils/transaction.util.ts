import { Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

export async function executeInTransaction<T>(
  dataSource: DataSource,
  fn: (manager: EntityManager) => Promise<T>,
  options?: { logger?: Logger; operationName?: string },
): Promise<T> {
  try {
    return await dataSource.transaction(fn);
  } catch (error) {
    if (options?.logger) {
      const op = options.operationName ? ` [${options.operationName}]` : '';
      options.logger.error(
        `Falha na transação${op}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
    throw error;
  }
}
