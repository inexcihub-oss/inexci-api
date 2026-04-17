import { APP_GUARD } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { RolesGuard } from './shared/guards/roles.guard';
import { CustomThrottlerGuard } from './shared/guards/custom-throttler.guard';
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
import { DocumentsKeyModule } from './modules/surgery-requests/documents-key/documents-key.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { PatientsModule } from './modules/patients/patients.module';
import { HospitalsModule } from './modules/hospitals/hospitals.module';
import { QuotationsModule } from './modules/surgery-requests/quotations/quotations.module';
import { ProceduresModule as SurgeryProceduresModule } from './modules/surgery-requests/procedures/procedures.module';
import { ReportsModule } from './modules/reports/reports.module';
import { CidModule } from './modules/surgery-requests/cid/cid.module';
import { HealthPlansModule } from './modules/health-plans/health-plans.module';
import { CronService } from './shared/cron/cron.service';
import { CronModule } from './shared/cron/cron.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { NotificationsHealthModule } from './modules/notifications/health/notifications-health.module';
import { UploadModule } from './modules/upload/upload.module';
import { TussModule } from './modules/tuss/tuss.module';
import { WhatsappModule } from './shared/whatsapp/whatsapp.module';
import { AccessControlModule } from './shared/services/access-control.module';
import { UserDoctorAccessModule } from './modules/user-doctor-access/user-doctor-access.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      load: [storageConfig, mailConfig],
    }),
    SupabaseModule,
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 3 },
      { name: 'medium', ttl: 10000, limit: 20 },
      { name: 'long', ttl: 60000, limit: 100 },
    ]),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          enableOfflineQueue: true,
          lazyConnect: true,
          maxRetriesPerRequest: null,
          retryStrategy: (times: number) => Math.min(times * 200, 5000),
        },
      }),
    }),
    AuthModule,
    DatabaseModule,
    AccessControlModule,
    UsersModule,
    OpmeModule,
    SurgeryRequestsModule,
    ProceduresModule,
    PendenciesModule,
    QuotationsModule,
    DocumentsModule,
    DocumentsKeyModule,
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
    ScheduleModule.forRoot(),
    CronModule,
  ],
  controllers: [],
  providers: [
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
  ],
  exports: [],
})
export class AppModule {}
