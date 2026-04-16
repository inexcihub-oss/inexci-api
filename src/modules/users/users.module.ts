import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/database/entities/user.entity';
import { UserDoctorAccess } from 'src/database/entities/user-doctor-access.entity';
import { DoctorProfile } from 'src/database/entities/doctor-profile.entity';
import { SubscriptionPlan } from 'src/database/entities/subscription-plan.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { EmailService } from 'src/shared/email/email.service';
import { JwtService } from '@nestjs/jwt';
import { StorageModule } from 'src/shared/storage/storage.module';
import { StorageService } from 'src/shared/storage/storage.service';
import { WhatsappModule } from 'src/shared/whatsapp/whatsapp.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      UserDoctorAccess,
      DoctorProfile,
      SubscriptionPlan,
    ]),
    StorageModule,
    WhatsappModule,
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    EmailService,
    JwtService,
    StorageService,
  ],
  exports: [UsersService],
})
export class UsersModule {}
