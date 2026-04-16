import { Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

/**
 * Executa um bloco de código dentro de uma transação do TypeORM.
 * Garante que qualquer erro seja registrado no logger antes de ser relançado,
 * evitando catches silenciosos nos services.
 *
 * @param dataSource - DataSource TypeORM injetado no service
 * @param fn         - Função assíncrona que recebe o EntityManager transacional
 * @param options    - Opções opcionais: logger e nome da operação para o log de erro
 */
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
