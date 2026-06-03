import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import IORedis, { RedisOptions } from 'ioredis';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { RolesGuard } from './shared/guards/roles.guard';
import { CustomThrottlerGuard } from './shared/guards/custom-throttler.guard';
import { ConsentsGuard } from './shared/guards/consents.guard';
import { LoggingInterceptor } from './shared/logging/logging.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { DatabaseModule } from './database/typeorm/database.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { envValidationSchema } from './config/app.config';
import { storageConfig } from './config/storage.config';
import { mailConfig } from './config/mail.config';
import { SupabaseModule } from './config/supabase.module';
import { SurgeryRequestsModule } from './modules/surgery-requests/surgery-requests.module';
import { OpmeModule } from './modules/surgery-requests/opme/opme.module';
import { ProceduresModule } from './modules/procedures/procedures.module';
import { PendenciesModule } from './modules/surgery-requests/pendencies/pendencies.module';
import { DocumentsModule } from './modules/surgery-requests/documents/documents.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { PatientsModule } from './modules/patients/patients.module';
import { HospitalsModule } from './modules/hospitals/hospitals.module';
import { ProceduresModule as SurgeryProceduresModule } from './modules/surgery-requests/procedures/procedures.module';
import { ReportsModule } from './modules/reports/reports.module';
import { CidModule } from './modules/surgery-requests/cid/cid.module';
import { HealthPlansModule } from './modules/health-plans/health-plans.module';
import { CronModule } from './shared/cron/cron.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { NotificationsHealthModule } from './modules/notifications/health/notifications-health.module';
import { UploadModule } from './modules/upload/upload.module';
import { TussModule } from './modules/tuss/tuss.module';
import { WhatsappModule } from './shared/whatsapp/whatsapp.module';
import { AccessControlModule } from './shared/services/access-control.module';
import { UserDoctorAccessModule } from './modules/user-doctor-access/user-doctor-access.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { AiModule } from './shared/ai/ai.module';
import { RagModule } from './shared/rag/rag.module';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AdminModule } from './modules/admin/admin.module';
import { BillingModule } from './modules/billing/billing.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      load: [storageConfig, mailConfig],
    }),
    SupabaseModule,
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },
      { name: 'medium', ttl: 10000, limit: 50 },
      { name: 'long', ttl: 60000, limit: 200 },
    ]),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const password = config.get<string>('REDIS_PASSWORD');
        const username = config.get<string>('REDIS_USERNAME');
        const tls = config.get<string>('REDIS_TLS') === 'true';

        const redisOptions: RedisOptions = {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          ...(username && { username }),
          ...(password && { password }),
          ...(tls && { tls: {} }),
          enableOfflineQueue: true,
          retryStrategy: (times: number) => Math.min(times * 200, 5000),
        };

        // Bull exige enableReadyCheck: false e maxRetriesPerRequest: null
        // para as conexões subscriber e bclient (ver bull#1873).
        const workerRedisOptions: RedisOptions = {
          ...redisOptions,
          enableReadyCheck: false,
          maxRetriesPerRequest: null,
        };

        // Compartilhando client e subscriber, reduzimos de 3×N para N+2 conexões,
        // evitando "ERR max number of clients reached" em planos com limite baixo.
        const sharedClient = new IORedis(redisOptions);
        const sharedSubscriber = new IORedis(workerRedisOptions);

        return {
          createClient: (type: 'client' | 'subscriber' | 'bclient') => {
            switch (type) {
              case 'client':
                return sharedClient;
              case 'subscriber':
                return sharedSubscriber;
              case 'bclient':
                // bclient precisa de conexão dedicada (operações de bloqueio)
                return new IORedis(workerRedisOptions);
              default:
                throw new Error(`Tipo de conexão Redis inesperado: ${type}`);
            }
          },
        };
      },
    }),
    AuthModule,
    DatabaseModule,
    AccessControlModule,
    UsersModule,
    OpmeModule,
    SurgeryRequestsModule,
    ProceduresModule,
    PendenciesModule,
    DocumentsModule,
    SuppliersModule,
    PatientsModule,
    HospitalsModule,
    SurgeryProceduresModule,
    ReportsModule,
    CidModule,
    HealthPlansModule,
    NotificationsModule,
    UploadModule,
    TussModule,
    WhatsappModule,
    UserDoctorAccessModule,
    NotificationsHealthModule,
    WebhookModule,
    AiModule,
    RagModule,
    PrivacyModule,
    AdminModule,
    BillingModule,
    BullBoardModule.forRoot({
      route: '/admin/queues',
      adapter: ExpressAdapter,
    }),
    BullBoardModule.forFeature({
      name: 'mail',
      adapter: BullAdapter,
    }),
    BullBoardModule.forFeature({
      name: 'whatsapp-messages',
      adapter: BullAdapter,
    }),
    BullBoardModule.forFeature({
      name: 'ai-messages',
      adapter: BullAdapter,
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    CronModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ConsentsGuard,
    },
  ],
  exports: [],
})
export class AppModule {}
