import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';
import { join } from 'path';

config();

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ['dist/database/entities/**/*.entity.js'],
  migrations: ['dist/database/typeorm/migrations/**/*.js'],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
};

// DataSource para migrations e CLI (deve ser default export)
const dataSource = new DataSource(dataSourceOptions);

export default dataSource;
