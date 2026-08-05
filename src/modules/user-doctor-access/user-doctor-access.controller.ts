import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import { SetUserDoctorAccessDto } from './dto/set-user-doctor-access.dto';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RequirePermission } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';
import { UserDoctorAccessService } from './user-doctor-access.service';

@ApiTags('Acesso Usuário-Médico')
@ApiBearerAuth()
@Controller('user-doctor-access')
@RequirePermission(Permission.ADMINISTRACAO)
export class UserDoctorAccessController {
  constructor(
    private readonly userDoctorAccessService: UserDoctorAccessService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar vínculos de acesso de um colaborador' })
  async getAccessForUser(
    @Query('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userDoctorAccessService.getAccessForUser(userId, user.userId);
  }

  @Put(':userId')
  @ApiOperation({
    summary: 'Redefinir lista completa de vínculos do colaborador',
  })
  async setAccess(
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
    @Body() body: SetUserDoctorAccessDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userDoctorAccessService.setAccess(
      userId,
      body.doctor_user_ids,
      user.userId,
    );
  }
}
