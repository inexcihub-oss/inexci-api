import * as bcrypt from 'bcryptjs';
import {
  buildAdminInsertExample,
  hashAdminPassword,
  parseHashAdminArgs,
  stripTrailingNewline,
  validateAdminPassword,
} from './hash-admin-password';

describe('yarn admin:hash-password', () => {
  it('aceita senha forte e recusa as fracas com a mensagem do backend', () => {
    expect(validateAdminPassword('Teste123@')).toBeNull();
    expect(validateAdminPassword('teste123@')).toMatch(/maiúscula/);
    expect(validateAdminPassword('Teste123')).toMatch(/especial/);
    expect(validateAdminPassword('Te1@')).not.toBeNull();
  });

  it('gera um hash bcrypt que confere com a senha', async () => {
    const hash = await hashAdminPassword('Teste123@', 4);

    expect(hash).toMatch(/^\$2[aby]\$04\$/);
    await expect(bcrypt.compare('Teste123@', hash)).resolves.toBe(true);
    await expect(bcrypt.compare('Outra123@', hash)).resolves.toBe(false);
  });

  it('usa BCRYPT_ROUNDS por padrão', async () => {
    const spy = jest.spyOn(bcrypt, 'hash').mockResolvedValue('hash' as never);

    await hashAdminPassword('Teste123@');

    expect(spy).toHaveBeenCalledWith('Teste123@', 12);
    spy.mockRestore();
  });

  it('remove só a quebra de linha final do pipe', () => {
    expect(stripTrailingNewline('Teste123@\n')).toBe('Teste123@');
    expect(stripTrailingNewline('Teste123@\r\n')).toBe('Teste123@');
    expect(stripTrailingNewline(' Teste123@ ')).toBe(' Teste123@ ');
  });

  it('monta o INSERT ativo com aspas escapadas', () => {
    const sql = buildAdminInsertExample('$2a$12$abc', {
      name: "Joana D'Arc",
      email: 'joana@inexci.com.br',
    });

    expect(sql).toBe(
      "INSERT INTO platform_admins (name, email, password_hash, status) VALUES ('Joana D''Arc', 'joana@inexci.com.br', '$2a$12$abc', 'active');",
    );
  });

  it('lê nome e e-mail dos argumentos, com valores de exemplo', () => {
    expect(
      parseHashAdminArgs(['--name=Ana Lima', '--email=Ana@Inexci.com.br']),
    ).toEqual({ name: 'Ana Lima', email: 'ana@inexci.com.br' });
    expect(parseHashAdminArgs([])).toEqual({
      name: 'Nome do administrador',
      email: 'admin@inexci.com.br',
    });
  });
});
