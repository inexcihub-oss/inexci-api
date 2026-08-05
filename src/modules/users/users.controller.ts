import { CreateUserDto } from './dto/create-user.dto';
import { FindManyUsersDto } from './dto/find-many.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateCollaboratorDto } from './dto/create-collaborator.dto';
import { UpdateCollaboratorDto } from './dto/update-collaborator.dto';
import { UpdateDoctorProfileDto } from './dto/update-doctor-profile.dto';
import { UpsertDoctorHeaderDto } from './dto/upsert-doctor-header.dto';
import { BulkDeleteCollaboratorsDto } from './dto/bulk-delete-collaborators.dto';
import { ResetCollaboratorPasswordDto } from './dto/reset-collaborator-password.dto';
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
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RequirePermission } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
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
    // `users.id` é `uuid`: sem o pipe, `?id=999999` chega cru ao repositório e
    // o Postgres aborta a query ("invalid input syntax for type uuid"), que o
    // `AllExceptionsFilter` traduz num 400 genérico de banco (500 nos e2e, que
    // não registram o filtro). O pipe devolve um 400 que diz o que está errado,
    // sem gastar ida ao banco — mesmo defeito que o `SurgeryRequestOwnerGuard`
    // tinha com o `:id` da solicitação.
    @Query('id', ParseUUIDPipe) id: string,
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

  @Post()
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Criar usuário (admin)' })
  async create(
    @Body() data: CreateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.create(data, user.userId);
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

  // Administração OU Solicitações: além do admin da conta, o editor de laudo
  // (MedicalReportEditor) usa esta rota para o colaborador vinculado ao
  // médico da solicitação subir/remover SOMENTE a assinatura — esse
  // colaborador tem Solicitações, não Administração. A barreira grossa aqui
  // é só isso: "está numa dessas duas áreas". Quem de fato restringe (o
  // vínculo colaborador↔médico e o campo permitido) é a checagem fina em
  // UsersService.updateDoctorProfileById (`isLinkedCollaborator` /
  // `onlySignature`), que continua intacta.
  @Patch('doctor-profile/:id')
  @RequirePermission(Permission.ADMINISTRACAO, Permission.SOLICITACOES)
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

  // ============ CABEÇALHO DE DOCUMENTOS ============

  @Get('me/header')
  @ApiOperation({
    summary: 'Obter cabeçalho personalizado do médico autenticado',
  })
  async getMyHeader(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getMyHeader(user.userId);
  }

  @Put('me/header')
  @ApiOperation({ summary: 'Criar/atualizar cabeçalho personalizado' })
  async upsertMyHeader(
    @Body() dto: UpsertDoctorHeaderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.upsertMyHeader(user.userId, dto);
  }

  @Delete('me/header')
  @ApiOperation({ summary: 'Remover cabeçalho personalizado' })
  async deleteMyHeader(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.deleteMyHeader(user.userId);
  }

  // Diferente do PATCH de perfil médico acima: o editor de laudo
  // (MedicalReportEditor) usa o cabeçalho do PRÓPRIO usuário (`/users/me/header`,
  // via `isOwnRequest`), nunca esta rota "por id". Só o admin da conta
  // configura o cabeçalho de outro médico (ex.: `colaboradores/assistente/[id]`).
  @Get('doctor-profile/:id/header')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Obter cabeçalho personalizado de um médico' })
  async getDoctorHeaderById(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.getDoctorHeaderByUserId(id, user.userId);
  }

  // Mesmo motivo do GET acima: só admin configura cabeçalho de terceiro.
  @Put('doctor-profile/:id/header')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Criar/atualizar cabeçalho de um médico' })
  async upsertDoctorHeaderById(
    @Param('id') id: string,
    @Body() dto: UpsertDoctorHeaderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.upsertDoctorHeaderByUserId(id, dto, user.userId);
  }

  // Mesmo motivo do GET acima: só admin configura cabeçalho de terceiro.
  @Delete('doctor-profile/:id/header')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Remover cabeçalho de um médico' })
  async deleteDoctorHeaderById(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.deleteDoctorHeaderByUserId(id, user.userId);
  }

  // ============ COLABORADORES ============

  @Get('doctors')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Listar médicos' })
  async findDoctors(@CurrentUser() user: AuthenticatedUser) {
    return await this.usersService.findDoctors(user.userId);
  }

  @Get('collaborators')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Listar colaboradores' })
  async findCollaborators(@CurrentUser() user: AuthenticatedUser) {
    return await this.usersService.findCollaborators(user.userId);
  }

  @Get('collaborators/:id')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Buscar colaborador por ID' })
  async findCollaboratorById(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.findCollaboratorById(id, user.userId);
  }

  @Post('collaborators')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Criar colaborador' })
  async createCollaborator(
    @Body() data: CreateCollaboratorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.createCollaborator(data, user.userId);
  }

  @Patch('collaborators/:id')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Atualizar colaborador' })
  async updateCollaborator(
    @Param('id') id: string,
    @Body() data: UpdateCollaboratorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.updateCollaborator(id, data, user.userId);
  }

  @Patch('collaborators/:id/status')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Alternar status ativo/inativo do colaborador' })
  async toggleCollaboratorStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.toggleCollaboratorStatus(id, user.userId);
  }

  @Patch('collaborators/:id/reset-password')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Redefinir senha do colaborador' })
  async resetCollaboratorPassword(
    @Param('id') id: string,
    @Body() body: ResetCollaboratorPasswordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.resetCollaboratorPassword(
      id,
      body.password,
      user.userId,
    );
  }

  @Post('collaborators/:id/resend-invite')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({
    summary: 'Reenviar e-mail de convite (link de primeiro acesso)',
  })
  async resendCollaboratorInvite(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.resendCollaboratorInvite(id, user.userId);
  }

  @Delete('collaborators/:id')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Excluir colaborador' })
  async deleteCollaborator(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.deleteCollaborator(id, user.userId);
  }

  @Post('collaborators/bulk-delete')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Excluir colaboradores em lote' })
  async bulkDeleteCollaborators(
    @Body() data: BulkDeleteCollaboratorsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.bulkDeleteCollaborators(
      data.ids,
      user.userId,
    );
  }
}
