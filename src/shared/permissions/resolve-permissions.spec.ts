import { UserRole } from 'src/database/entities/user.entity';
import {
  ALL_PERMISSIONS,
  Permission,
  resolveEffectivePermissions,
} from './index';

describe('resolveEffectivePermissions', () => {
  it('dá tudo ao dono da conta, mesmo com o array vazio', () => {
    expect(
      resolveEffectivePermissions({
        role: UserRole.ADMIN,
        permissions: [],
        isDoctor: false,
      }),
    ).toEqual(ALL_PERMISSIONS);
  });

  it('devolve exatamente o array do colaborador não-médico', () => {
    expect(
      resolveEffectivePermissions({
        role: UserRole.COLLABORATOR,
        permissions: [Permission.AGENDA],
        isDoctor: false,
      }),
    ).toEqual([Permission.AGENDA]);
  });

  /**
   * Finalizar ficha com indicação cirúrgica abre a SC. Sem SOLICITACOES o
   * médico criaria uma solicitação invisível para ele mesmo.
   */
  it('acrescenta atendimento e solicitações a quem é médico', () => {
    expect(
      resolveEffectivePermissions({
        role: UserRole.COLLABORATOR,
        permissions: [Permission.AGENDA],
        isDoctor: true,
      }),
    ).toEqual([
      Permission.AGENDA,
      Permission.ATENDIMENTO,
      Permission.SOLICITACOES,
    ]);
  });

  it('não dá administração ao médico por ser médico', () => {
    expect(
      resolveEffectivePermissions({
        role: UserRole.COLLABORATOR,
        permissions: [],
        isDoctor: true,
      }),
    ).not.toContain(Permission.ADMINISTRACAO);
  });

  it('trata null e undefined como array vazio', () => {
    expect(
      resolveEffectivePermissions({
        role: UserRole.COLLABORATOR,
        permissions: null,
        isDoctor: false,
      }),
    ).toEqual([]);
    expect(
      resolveEffectivePermissions({
        role: UserRole.COLLABORATOR,
        isDoctor: false,
      }),
    ).toEqual([]);
  });

  it('descarta valor desconhecido vindo do banco', () => {
    expect(
      resolveEffectivePermissions({
        role: UserRole.COLLABORATOR,
        permissions: ['financeiro' as Permission, Permission.AGENDA],
        isDoctor: false,
      }),
    ).toEqual([Permission.AGENDA]);
  });

  it('devolve sempre na mesma ordem, independente da ordem gravada', () => {
    expect(
      resolveEffectivePermissions({
        role: UserRole.COLLABORATOR,
        permissions: [Permission.SOLICITACOES, Permission.AGENDA],
        isDoctor: false,
      }),
    ).toEqual([Permission.AGENDA, Permission.SOLICITACOES]);
  });

  it('não deixa o chamador alterar ALL_PERMISSIONS pelo retorno', () => {
    const resultado = resolveEffectivePermissions({
      role: UserRole.ADMIN,
      permissions: [],
      isDoctor: false,
    });
    resultado.pop();
    expect(ALL_PERMISSIONS).toHaveLength(4);
  });
});
