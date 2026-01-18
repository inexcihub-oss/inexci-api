import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as entities from '../entities';
import * as repositories from '../repositories';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        url: configService.get('DATABASE_URL'),
        entities: Object.values(entities),
        synchronize: false,
        logging: configService.get('NODE_ENV') === 'development',
      }),
    }),
    TypeOrmModule.forFeature(Object.values(entities)),
  ],
  providers: Object.values(repositories),
  exports: [TypeOrmModule, ...Object.values(repositories)],
})
export class DatabaseModule {}
