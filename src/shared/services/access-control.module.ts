import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlService } from './access-control.service';
import { User } from '../../database/entities/user.entity';
import { DoctorProfile } from '../../database/entities/doctor-profile.entity';
import { UserDoctorAccess } from '../../database/entities/user-doctor-access.entity';
/**
 * Módulo global que exporta o AccessControlService.
 * Deve ser importado no AppModule para estar disponível em toda a aplicação.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([User, DoctorProfile, UserDoctorAccess])],
  providers: [AccessControlService],
  exports: [AccessControlService],
})
export class AccessControlModule {}
