import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { join } from 'path';
import { CompactTypeOrmLogger } from '../../shared/logging/typeorm.logger';
import { resolvePostgresSsl } from './postgres-ssl';

config();

const isDev = process.env.NODE_ENV === 'development';

export const SeedDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: resolvePostgresSsl(),
  entities: [join(__dirname, '..', 'entities', '*.entity{.ts,.js}')],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  synchronize: false,
  logging: isDev
    ? ['query', 'error', 'schema', 'warn', 'migration']
    : ['error', 'warn', 'migration'],
  logger: new CompactTypeOrmLogger(),
  maxQueryExecutionTime: 1000,
});
