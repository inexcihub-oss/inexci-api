import * as bcrypt from 'bcryptjs';
import { BCRYPT_ROUNDS } from '../../shared/constants/bcrypt';
import {
  STRONG_PASSWORD_MESSAGE,
  STRONG_PASSWORD_REGEX,
} from '../../shared/validators/strong-password.decorator';

export interface HashAdminArgs {
  name: string;
  email: string;
}

export function parseHashAdminArgs(argv: string[]): HashAdminArgs {
  const valor = (chave: string): string | undefined =>
    argv
      .find((arg) => arg.startsWith(`--${chave}=`))
      ?.slice(chave.length + 3)
      .trim();
  return {
    name: valor('name') || 'Nome do administrador',
    email: (valor('email') || 'admin@inexci.com.br').toLowerCase(),
  };
}

export function validateAdminPassword(password: string): string | null {
  return STRONG_PASSWORD_REGEX.test(password) ? null : STRONG_PASSWORD_MESSAGE;
}

export function stripTrailingNewline(raw: string): string {
  return raw.replace(/\r?\n$/, '');
}

export function hashAdminPassword(
  password: string,
  rounds: number = BCRYPT_ROUNDS,
): Promise<string> {
  return bcrypt.hash(password, rounds);
}

function literalSql(valor: string): string {
  return `'${valor.replace(/'/g, "''")}'`;
}

export function buildAdminInsertExample(
  hash: string,
  args: HashAdminArgs,
): string {
  return `INSERT INTO platform_admins (name, email, password_hash, status) VALUES (${literalSql(args.name)}, ${literalSql(args.email)}, ${literalSql(hash)}, 'active');`;
}

function lerDoPipe(): Promise<string> {
  return new Promise((resolve, reject) => {
    let dados = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (parte: string) => {
      dados += parte;
    });
    process.stdin.on('end', () => resolve(stripTrailingNewline(dados)));
    process.stdin.on('error', reject);
  });
}

function lerSemEco(rotulo: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const entrada = process.stdin;
    process.stderr.write(rotulo);
    let senha = '';
    entrada.setRawMode(true);
    entrada.resume();
    entrada.setEncoding('utf8');
    const encerrar = () => {
      entrada.setRawMode(false);
      entrada.pause();
      entrada.removeListener('data', aoDigitar);
      process.stderr.write('\n');
    };
    const aoDigitar = (tecla: string) => {
      for (const caractere of tecla) {
        if (caractere === '\u0003') {
          encerrar();
          reject(new Error('Cancelado.'));
          return;
        }
        if (
          caractere === '\r' ||
          caractere === '\n' ||
          caractere === '\u0004'
        ) {
          encerrar();
          resolve(senha);
          return;
        }
        if (caractere === '\u007f' || caractere === '\b') {
          senha = senha.slice(0, -1);
          continue;
        }
        senha += caractere;
      }
    };
    entrada.on('data', aoDigitar);
  });
}

async function lerSenha(): Promise<string> {
  if (!process.stdin.isTTY) return lerDoPipe();
  const senha = await lerSemEco('Senha do administrador: ');
  const confirmacao = await lerSemEco('Repita a senha: ');
  if (senha !== confirmacao) throw new Error('As senhas não conferem.');
  return senha;
}

async function main(): Promise<void> {
  const args = parseHashAdminArgs(process.argv.slice(2));
  const senha = await lerSenha();
  const erro = validateAdminPassword(senha);
  if (erro) throw new Error(erro);

  const hash = await hashAdminPassword(senha);
  process.stdout.write(`${hash}\n\n`);
  process.stdout.write(`${buildAdminInsertExample(hash, args)}\n`);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
