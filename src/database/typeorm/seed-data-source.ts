import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { join } from 'path';

config();

// DataSource específico para seed com entities em TypeScript
export const SeedDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [join(__dirname, '..', 'entities', '*.entity{.ts,.js}')],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
});
