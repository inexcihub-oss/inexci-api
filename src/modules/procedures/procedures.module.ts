import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Procedure } from 'src/database/entities/procedure.entity';
import { ProceduresService } from './procedures.service';
import { ProceduresController } from './procedures.controller';
import { ProcedureRepository } from 'src/database/repositories/procedure.repository';

@Module({
  imports: [TypeOrmModule.forFeature([Procedure])],
  controllers: [ProceduresController],
  providers: [ProceduresService, ProcedureRepository],
})
export class ProceduresModule {}
