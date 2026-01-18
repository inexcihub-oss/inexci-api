import { APP_GUARD } from '@nestjs/core';
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { UserRepository } from './database/repositories/user.repository';
import { AccessLevel } from './middlewares/access-level.middleware';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { DatabaseModule } from './database/typeorm/database.module';
import { ConfigModule } from '@nestjs/config';
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
import { HealthPlansModule } from './modules/health_plan/health_plans.module';
import { CronService } from './shared/cron/cron.service';
import { CronModule } from './shared/cron/cron.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    DatabaseModule,
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
    ScheduleModule.forRoot(),
    CronModule,
  ],
  controllers: [],
  providers: [
    UserRepository,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  exports: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AccessLevel)
      .exclude({ path: 'auth/login', method: RequestMethod.ALL })
      .forRoutes('*');
  }
}
