import { CompleteRegisterDto } from './dto/complete-register.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { FindManyUsersDto } from './dto/find-many.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateCollaboratorDto } from './dto/create-collaborator.dto';
import { UpdateCollaboratorDto } from './dto/update-collaborator.dto';
import { UpdateDoctorProfileDto } from './dto/update-doctor-profile.dto';
import { UsersService } from './users.service';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from 'src/shared/decorators/roles.decorator';
import { UserRole } from 'src/database/entities/user.entity';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';

@ApiTags('Usuários')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Listar usuários' })
  async findMany(
    @Query() query: FindManyUsersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.findMany(query, user.userId);
  }

  @Get('one')
  @ApiOperation({ summary: 'Buscar usuário por ID' })
  async findOne(
    @Query() { id }: { id: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.findOne(id, user.userId);
  }

  @Get('profile')
  @ApiOperation({ summary: 'Obter perfil do usuário autenticado' })
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    return await this.usersService.getProfile(user.userId);
  }

  @Put('profile')
  @ApiOperation({ summary: 'Atualizar perfil' })
  async updateProfile(
    @Body() data: UpdateProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.updateProfile(data, user.userId);
  }

  @Get('complete-register/validate-link')
  @ApiOperation({ summary: 'Validar link de cadastro completo' })
  async validateCompleteRegisterLink(@CurrentUser() user: AuthenticatedUser) {
    return await this.usersService.validateCompleteRegisterLink(user.userId);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Criar usuário (admin)' })
  async create(
    @Body() data: CreateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.create(data, user.userId);
  }

  @Post('complete-register')
  @ApiOperation({ summary: 'Completar cadastro' })
  async completeRegister(
    @Body() data: CompleteRegisterDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.completeRegister(data, user.userId);
  }

  @Put()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Atualizar usuário (admin)' })
  async update(
    @Body() data: UpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.update(data, user.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar perfil por ID' })
  async updateProfileById(
    @Param('id') id: string,
    @Body() data: UpdateProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.updateProfileById(id, data, user.userId);
  }

  // ============ PERFIL MÉDICO ============

  @Patch('doctor-profile/:id')
  @ApiOperation({ summary: 'Atualizar perfil médico' })
  async updateDoctorProfile(
    @Param('id') id: string,
    @Body() data: UpdateDoctorProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.updateDoctorProfileById(
      id,
      data,
      user.userId,
    );
  }

  // ============ COLABORADORES ============

  @Get('doctors')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Listar médicos' })
  async findDoctors(@CurrentUser() user: AuthenticatedUser) {
    return await this.usersService.findDoctors(user.userId);
  }

  @Get('collaborators')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Listar colaboradores' })
  async findCollaborators(@CurrentUser() user: AuthenticatedUser) {
    return await this.usersService.findCollaborators(user.userId);
  }

  @Get('collaborators/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Buscar colaborador por ID' })
  async findCollaboratorById(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.findCollaboratorById(id, user.userId);
  }

  @Post('collaborators')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Criar colaborador' })
  async createCollaborator(
    @Body() data: CreateCollaboratorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.createCollaborator(data, user.userId);
  }

  @Patch('collaborators/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Atualizar colaborador' })
  async updateCollaborator(
    @Param('id') id: string,
    @Body() data: UpdateCollaboratorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.updateCollaborator(id, data, user.userId);
  }

  @Delete('collaborators/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Excluir colaborador' })
  async deleteCollaborator(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.deleteCollaborator(id, user.userId);
  }
}
