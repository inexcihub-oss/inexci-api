import {
  normalizarCpf,
  normalizarData,
  normalizarEmail,
  normalizarSexo,
  normalizarTexto,
  telefonesDistintos,
} from '../../core/normalizers';
import { ContextoImportacao } from '../context';
import { ExportFeegow, excluido } from '../export';
import { Permission } from 'src/shared/permissions/permission.enum';
import { ProfessionalCouncil } from 'src/database/entities/doctor-profile.entity';
import { UserRole, UserStatus } from 'src/database/entities/user.entity';
import { UserDoctorAccessStatus } from 'src/database/entities/user-doctor-access.entity';

export const LEDGER_PROFISSIONAL = 'user:prof';
export const LEDGER_FUNCIONARIO = 'user:func';

export interface NovoUsuario {
  id: string;
  role: UserRole;
  status: UserStatus;
  email: string;
  name: string;
  phone: string;
  cpf: string | null;
  gender: string | null;
  birthDate: Date | null;
  password: null;
  ownerId: string;
  adminId: string;
  permissions: Permission[];
}

export interface NovoPerfil {
  id: string;
  userId: string;
  council: ProfessionalCouncil;
  crm: string | null;
  crmState: string | null;
  specialty: string | null;
}

export interface NovoAcesso {
  id: string;
  userId: string;
  doctorUserId: string;
  status: UserDoctorAccessStatus;
  createdById: string;
}

export interface PlanoEquipe {
  usuarios: NovoUsuario[];
  perfis: NovoPerfil[];
  acessos: NovoAcesso[];
}

/** `conselhos_profissionais.codigo` do Feegow → conselho da INEXCI. */
const CONSELHOS: Record<string, ProfessionalCouncil> = {
  CRM: ProfessionalCouncil.CRM,
  CRP: ProfessionalCouncil.CRP,
  CRN: ProfessionalCouncil.CRN,
  COREN: ProfessionalCouncil.COREN,
  CREFITO: ProfessionalCouncil.CREFITO,
  CRFA: ProfessionalCouncil.CRFA,
  CRO: ProfessionalCouncil.CRO,
  CRBM: ProfessionalCouncil.CRBM,
  CREF: ProfessionalCouncil.CREF,
};

interface Pessoa {
  tipo: 'prof' | 'func';
  idOrigem: string;
  nome: string | null;
  email: string | null;
  telefone: string | null;
  cpf: string | null;
  sexo: 'M' | 'F' | null;
  nascimento: string | null;
  ativo: boolean;
  excluido: boolean;
  perfil: Omit<NovoPerfil, 'id' | 'userId'> | null;
  permissoes: Permission[];
}

/**
 * Equipe: cada profissional e funcionário do Feegow vira (ou casa com) um
 * usuário da INEXCI.
 *
 * - Casa com usuário existente **da mesma conta** pelo e-mail do export (ou
 *   pelo `--mapear`). É assim que o dono entra: ele já fez o cadastro.
 * - Senão, cria colaborador `pending` (sem senha — o admin reenvia o convite
 *   pela tela) ou `inactive` se estava desativado no Feegow.
 * - Profissional ganha `doctor_profile` com o conselho do Feegow; sem conselho
 *   → `OUTRO`. Número sem UF (o Feegow não guarda a UF do registro).
 * - Todo colaborador fica vinculado a todo profissional: o Feegow não tem esse
 *   recorte, todo mundo via tudo.
 */
export function planejarEquipe(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): PlanoEquipe {
  const rel = ctx.relatorio;
  const plano: PlanoEquipe = { usuarios: [], perfis: [], acessos: [] };
  const telefonesReservados = new Set(ctx.telefonesEmUso);

  const pessoas = [...lerProfissionais(exp), ...lerFuncionarios(exp)];
  const profissionaisDaConta: string[] = [];
  const colaboradoresDaConta: string[] = [];

  for (const p of pessoas) {
    const entidade =
      p.tipo === 'prof' ? LEDGER_PROFISSIONAL : LEDGER_FUNCIONARIO;
    const rotulo = p.tipo === 'prof' ? 'profissional' : 'funcionário';

    const jaImportado = ctx.ledger.resolver(entidade, p.idOrigem);
    if (jaImportado) {
      rel.pular(rotulo);
      if (p.perfil) profissionaisDaConta.push(jaImportado);
      if (jaImportado !== ctx.ownerId) colaboradoresDaConta.push(jaImportado);
      continue;
    }
    if (p.excluido) {
      rel.rejeitar(rotulo, p.idOrigem, 'excluído no Feegow');
      continue;
    }

    const emailForcado = ctx.mapear.get(`${p.tipo}:${p.idOrigem}`);
    const email = emailForcado ?? p.email;
    const existente = email ? ctx.usuariosPorEmail.get(email) : undefined;

    if (existente) {
      if (existente.ownerId !== ctx.ownerId) {
        rel.rejeitar(
          rotulo,
          p.idOrigem,
          'e-mail já usado em outra conta da INEXCI — cadastre com outro e-mail e use --mapear',
        );
        continue;
      }
      ctx.ledger.registrar(entidade, p.idOrigem, existente.id);
      rel.aceitar(`${rotulo} (casado com usuário existente)`);
      if (p.perfil) {
        if (existente.temPerfil) profissionaisDaConta.push(existente.id);
        else
          rel.avisar(
            rotulo,
            p.idOrigem,
            'usuário existente sem perfil profissional — consultas e fichas dele não terão dono; marque-o como profissional na tela antes da carga',
          );
      }
      if (existente.id !== ctx.ownerId) colaboradoresDaConta.push(existente.id);
      continue;
    }

    if (emailForcado) {
      rel.rejeitar(
        rotulo,
        p.idOrigem,
        `--mapear aponta para ${emailForcado}, que não existe`,
      );
      continue;
    }
    if (!p.nome) {
      rel.rejeitar(rotulo, p.idOrigem, 'sem nome');
      continue;
    }
    if (!p.email) {
      rel.rejeitar(
        rotulo,
        p.idOrigem,
        'sem e-mail válido (obrigatório para login)',
      );
      continue;
    }
    if (!p.telefone) {
      rel.rejeitar(
        rotulo,
        p.idOrigem,
        'sem celular válido (obrigatório e único)',
      );
      continue;
    }
    if (telefonesReservados.has(p.telefone)) {
      rel.rejeitar(rotulo, p.idOrigem, 'celular já usado por outro usuário');
      continue;
    }
    telefonesReservados.add(p.telefone);

    const id = ctx.novoId();
    plano.usuarios.push({
      id,
      role: UserRole.COLLABORATOR,
      status: p.ativo ? UserStatus.PENDING : UserStatus.INACTIVE,
      email: p.email,
      name: p.nome,
      phone: p.telefone,
      cpf: p.cpf,
      gender: p.sexo,
      birthDate: p.nascimento ? new Date(`${p.nascimento}T12:00:00Z`) : null,
      password: null,
      ownerId: ctx.ownerId,
      adminId: ctx.ownerId,
      permissions: p.permissoes,
    });
    if (p.perfil) {
      plano.perfis.push({ id: ctx.novoId(), userId: id, ...p.perfil });
      profissionaisDaConta.push(id);
      if (p.perfil.council === ProfessionalCouncil.OUTRO) {
        rel.avisar(
          rotulo,
          p.idOrigem,
          'sem conselho no Feegow — entra como OUTRO; ajuste o conselho na tela de colaboradores',
        );
      }
    }
    colaboradoresDaConta.push(id);
    ctx.ledger.registrar(entidade, p.idOrigem, id);
    rel.aceitar(rotulo);
  }

  for (const userId of new Set(colaboradoresDaConta)) {
    for (const doctorUserId of new Set(profissionaisDaConta)) {
      if (userId === doctorUserId) continue;
      plano.acessos.push({
        id: ctx.novoId(),
        userId,
        doctorUserId,
        status: UserDoctorAccessStatus.ACTIVE,
        createdById: ctx.ownerId,
      });
    }
  }
  rel.aceitar('vínculo colaborador-profissional', plano.acessos.length);

  return plano;
}

function lerProfissionais(exp: ExportFeegow): Pessoa[] {
  const conselhoPorId = new Map(
    exp.tabela('conselhos_profissionais').map((c) => [c.id, c.codigo]),
  );
  const especialidadePorProf = new Map(
    exp
      .tabela('profissional_especialidades')
      .map((pe) => [pe.profissional_id, pe.especialidade_id]),
  );
  const nomeEspecialidade = new Map(
    exp.tabela('especialidades').map((e) => [e.id, e.nome_especialidade]),
  );

  return exp.tabela('profissionais').map((p) => {
    const codigo = (conselhoPorId.get(p.conselho_id ?? '') ?? '').toUpperCase();
    const council = CONSELHOS[codigo] ?? ProfessionalCouncil.OUTRO;
    const especialidade = nomeEspecialidade.get(
      especialidadePorProf.get(p.id ?? '') ?? '',
    );
    return {
      tipo: 'prof' as const,
      idOrigem: p.id!,
      nome: normalizarTexto(p.nome_profissional, 100),
      email: normalizarEmail(p.email1) ?? normalizarEmail(p.email2),
      telefone:
        telefonesDistintos([
          p.celular1,
          p.celular2,
          p.telefone1,
          p.telefone2,
        ])[0] ?? null,
      cpf: normalizarCpf(p.cpf),
      sexo: normalizarSexo(p.sexo_id),
      nascimento: normalizarData(p.nascimento),
      ativo: p.ativo === 'on',
      excluido: excluido(p),
      perfil: {
        council,
        crm: normalizarTexto(p.documento_conselho, 20),
        crmState: null,
        specialty: normalizarTexto(especialidade, 100),
      },
      // O perfil já dá as áreas (agenda + atendimento, e solicitações se CRM).
      permissoes: [],
    };
  });
}

/**
 * Chave do Feegow que permite alterar usuários. Quem a tem administra a equipe
 * lá e ganha Administração aqui. Mais robusto que exigir o perfil "acesso
 * master" inteiro: no export deste cliente, os funcionários administradores
 * têm 677 das 678 chaves do perfil (falta só excluir usuário).
 */
export const CHAVE_GERIR_USUARIOS = 'usuariosA';

function lerFuncionarios(exp: ExportFeegow): Pessoa[] {
  const loginPorFuncionario = new Map(
    exp
      .tabela('usuarios')
      .filter((u) => (u.tipo_usuario ?? '').toLowerCase() === 'funcionarios')
      .map((u) => [u.id_relativo, u]),
  );

  return exp.tabela('funcionarios').map((f) => {
    const login = loginPorFuncionario.get(f.id);
    const permissoes = conjuntoDePermissoes(login?.permissoes);
    // Recepção agenda; quem gere usuários no Feegow também administra aqui.
    // Ajustável na tela depois da carga.
    const administra = permissoes.has(CHAVE_GERIR_USUARIOS);
    return {
      tipo: 'func' as const,
      idOrigem: f.id!,
      nome: normalizarTexto(f.nome_funcionario, 100),
      email: normalizarEmail(f.email),
      telefone: telefonesDistintos([f.celular])[0] ?? null,
      cpf: normalizarCpf(f.cpf),
      sexo: normalizarSexo(f.sexo_id),
      nascimento: normalizarData(f.nascimento),
      ativo: f.ativo === 'on',
      excluido: excluido(f),
      perfil: null,
      permissoes: administra
        ? [Permission.AGENDA, Permission.ADMINISTRACAO]
        : [Permission.AGENDA],
    };
  });
}

/** `|agendaV|, |agendaI|, ...` → conjunto de chaves. */
export function conjuntoDePermissoes(
  texto: string | null | undefined,
): Set<string> {
  return new Set(
    (texto ?? '')
      .split(',')
      .map((p) =>
        p
          .trim()
          .replace(/^\||\|$/g, '')
          .trim(),
      )
      .filter(Boolean),
  );
}

/**
 * Usuário do Feegow (`usuarios.id`, o `usuario_id`/`usuario` dos agendamentos
 * e do log) → uuid do usuário importado. Um usuário do Feegow é um
 * profissional ou um funcionário (`tipo_usuario` + `id_relativo`). Fora do
 * mapa (`0`, sistema, equipe não importada) = sem autor.
 */
export function autoresDoFeegow(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): Map<string, string | null> {
  return new Map(
    exp.tabela('usuarios').map((u): [string, string | null] => {
      const tipo = (u.tipo_usuario ?? '').toLowerCase();
      const entidade =
        tipo === 'profissionais'
          ? LEDGER_PROFISSIONAL
          : tipo === 'funcionarios'
            ? LEDGER_FUNCIONARIO
            : null;
      return [
        u.id ?? '',
        entidade ? ctx.ledger.resolver(entidade, u.id_relativo) : null,
      ];
    }),
  );
}

/**
 * Como `autoresDoFeegow`, mas só para usuários que são **profissionais**:
 * o médico de uma ficha não pode ser um funcionário da recepção.
 */
export function profissionaisDoFeegow(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const u of exp.tabela('usuarios')) {
    if ((u.tipo_usuario ?? '').toLowerCase() !== 'profissionais') continue;
    const uuid = ctx.ledger.resolver(LEDGER_PROFISSIONAL, u.id_relativo);
    if (u.id && uuid) mapa.set(u.id, uuid);
  }
  return mapa;
}
