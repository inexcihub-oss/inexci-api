import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';
import { join } from 'path';

config();

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [join(__dirname, '..', 'entities', '*.entity{.ts,.js}')],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
  migrationsTransactionMode: 'each',
  extra: {
    charset: 'utf8mb4',
  },
};

// DataSource para migrations e CLI (deve ser default export)
const dataSource = new DataSource(dataSourceOptions);

export default dataSource;
