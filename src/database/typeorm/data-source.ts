import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';
import { join } from 'path';
import { CompactTypeOrmLogger } from '../../shared/logging/typeorm.logger';

config();

const isDev = process.env.NODE_ENV === 'development';

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [join(__dirname, '..', 'entities', '*.entity{.ts,.js}')],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  synchronize: false,
  logging: isDev
    ? ['query', 'error', 'schema', 'warn', 'migration']
    : ['error', 'warn', 'migration'],
  logger: new CompactTypeOrmLogger(),
  maxQueryExecutionTime: 1000,
  migrationsTransactionMode: 'each',
  extra: {
    charset: 'utf8mb4',
  },
};

// DataSource para migrations e CLI (deve ser default export)
const dataSource = new DataSource(dataSourceOptions);

export default dataSource;
