import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Roles } from 'src/shared/decorators/roles.decorator';
import { UserRole } from 'src/database/entities/user.entity';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';
import { UserDoctorAccessService } from './user-doctor-access.service';

@Controller('user-doctor-access')
@Roles(UserRole.ADMIN)
export class UserDoctorAccessController {
  constructor(
    private readonly userDoctorAccessService: UserDoctorAccessService,
  ) {}

  /**
   * GET /user-doctor-access?userId=
   * Retorna vínculos de um collaborator.
   */
  @Get()
  async getAccessForUser(
    @Query('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userDoctorAccessService.getAccessForUser(
      userId,
      user.userId,
    );
  }

  /**
   * GET /user-doctor-access/all
   * Todos os vínculos da conta.
   */
  @Get('all')
  async getAccessList(@CurrentUser() user: AuthenticatedUser) {
    return this.userDoctorAccessService.getAccessList(user.userId);
  }

  /**
   * PUT /user-doctor-access/:userId
   * Redefine lista completa de vínculos.
   */
  @Put(':userId')
  async setAccess(
    @Param('userId') userId: string,
    @Body() body: { doctor_user_ids: string[] },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userDoctorAccessService.setAccess(
      userId,
      body.doctor_user_ids,
      user.userId,
    );
  }

  /**
   * POST /user-doctor-access
   * Adiciona/ativa vínculo individual.
   */
  @Post()
  async addAccess(
    @Body() body: { user_id: string; doctor_user_id: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userDoctorAccessService.addAccess(
      body.user_id,
      body.doctor_user_id,
      user.userId,
    );
  }

  /**
   * PATCH /user-doctor-access/:userId/:doctorUserId/deactivate
   * Desativa vínculo individual.
   */
  @Patch(':userId/:doctorUserId/deactivate')
  async deactivateAccess(
    @Param('userId') userId: string,
    @Param('doctorUserId') doctorUserId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userDoctorAccessService.deactivateAccess(
      userId,
      doctorUserId,
      user.userId,
    );
  }
}
