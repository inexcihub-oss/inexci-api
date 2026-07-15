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
          // Em dev: liga query+error+schema+warn+migration (não 'info'/'log'
          // ruidoso). Em prod: apenas erros e slow queries. O CompactTypeOrmLogger
          // sumariza cada query para "OPERACAO tabela".
          logging: isDev
            ? ['query', 'error', 'schema', 'warn', 'migration']
            : ['error', 'warn', 'migration'],
          logger: new CompactTypeOrmLogger(),
          maxQueryExecutionTime: 1000,
          // Pool de conexões explícito (P4/P16): tamanho ajustável por env para
          // afinar sob carga sem recompilar. `pg` usa 10 por padrão.
          extra: {
            max: Number(configService.get('DATABASE_POOL_MAX')) || 10,
            // Mantém conexões vivas — evita reabrir/pagar handshake SSL a cada
            // request (servidor de vida longa, não serverless).
            keepAlive: true,
            // Aborta queries travadas em vez de segurar conexão presa no pool.
            statement_timeout: 15_000,
            query_timeout: 15_000,
            // Identifica a app nos logs/monitoring do Supabase.
            application_name: 'inexci-api',
            // Não deixa conexão ociosa presa (o pooler tem limite de conexões).
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
