import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';
import { User } from 'src/database/entities/user.entity';
import { StatusUpdate } from 'src/database/entities/status-update.entity';
import { SurgeryRequestsService } from './surgery-requests.service';
import { SurgeryRequestsController } from './surgery-requests.controller';
import { UsersModule } from '../users/users.module';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { StorageService } from 'src/shared/storage/storage.service';
import { ChatsModule } from './chats/chats.module';
import { EmailModule } from 'src/shared/email/email.module';
import { PendenciesModule } from './pendencies/pendencies.module';
import { StatusUpdateRepository } from 'src/database/repositories/status-update.repository';
import { DocumentsModule } from './documents/documents.module';
import { DocumentsKeyModule } from './documents-key/documents-key.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SurgeryRequest, User, StatusUpdate]),
    UsersModule,
    ChatsModule,
    EmailModule,
    PendenciesModule,
    DocumentsModule,
    DocumentsKeyModule,
  ],
  controllers: [SurgeryRequestsController],
  providers: [
    SurgeryRequestsService,
    SurgeryRequestRepository,
    UserRepository,
    StorageService,
    StatusUpdateRepository,
  ],
  exports: [SurgeryRequestsService],
})
export class SurgeryRequestsModule {}
