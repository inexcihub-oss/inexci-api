import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Patient } from 'src/database/entities/patient.entity';
import { User } from 'src/database/entities/user.entity';
import { PatientsService } from './patients.service';
import { PatientsController } from './patients.controller';
import { WhatsappModule } from 'src/shared/whatsapp/whatsapp.module';
import { MailModule } from 'src/shared/mail/mail.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Patient, User]),
    WhatsappModule,
    MailModule,
  ],
  controllers: [PatientsController],
  providers: [PatientsService],
})
export class PatientsModule {}
