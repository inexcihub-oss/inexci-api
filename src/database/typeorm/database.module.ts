import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ENTITIES } from '../entities';
import * as repositories from '../repositories';
import { CompactTypeOrmLogger } from '../../shared/logging/typeorm.logger';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isDev = configService.get('NODE_ENV') === 'development';
        return {
          type: 'postgres',
          url: configService.get('DATABASE_URL'),
          entities: ENTITIES,
          synchronize: false,
          logging: isDev
            ? ['query', 'error', 'schema', 'warn', 'migration']
            : ['error', 'warn', 'migration'],
          logger: new CompactTypeOrmLogger(),
          maxQueryExecutionTime: 1000,
          extra: {
            max: Number(configService.get('DATABASE_POOL_MAX')) || 10,
            keepAlive: true,
            statement_timeout: 15_000,
            query_timeout: 15_000,
            application_name: 'inexci-api',
            idleTimeoutMillis: 30_000,
          },
        };
      },
    }),
    TypeOrmModule.forFeature(ENTITIES),
  ],
  providers: Object.values(repositories),
  exports: [TypeOrmModule, ...Object.values(repositories)],
})
export class DatabaseModule {}
