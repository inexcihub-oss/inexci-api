import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateCollaboratorDto } from './create-collaborator.dto';
import { CreateUserDto } from './create-user.dto';
import { UpdateCollaboratorDto } from './update-collaborator.dto';
import { UpdateProfileDto } from './update-profile.dto';
import { RegisterDto } from '../../auth/dto/register.dto';
import { CheckPhoneDto } from '../../auth/dto/check-phone.dto';
import { normalizarTelefoneDeUsuario } from 'src/shared/pipes/phone-mask.pipe';

type Dto = new () => object;

const BASES: Array<[string, Dto, Record<string, unknown>]> = [
  [
    'RegisterDto',
    RegisterDto,
    { name: 'Ana Souza', email: 'ana@email.com', password: 'Senha@123' },
  ],
  ['CheckPhoneDto', CheckPhoneDto, {}],
  [
    'CreateUserDto',
    CreateUserDto,
    { name: 'Ana Souza', email: 'ana@email.com' },
  ],
  [
    'CreateCollaboratorDto',
    CreateCollaboratorDto,
    { name: 'Ana Souza', email: 'ana@email.com' },
  ],
  ['UpdateCollaboratorDto', UpdateCollaboratorDto, {}],
  ['UpdateProfileDto', UpdateProfileDto, {}],
];

async function montar(
  classe: Dto,
  base: Record<string, unknown>,
  phone: unknown,
) {
  const dto = plainToInstance(classe, { ...base, phone }) as {
    phone?: unknown;
  };
  const erros = await validate(dto);
  return { dto, erroDeTelefone: erros.find((e) => e.property === 'phone') };
}

describe.each(BASES)('%s — telefone de usuário', (_nome, classe, base) => {
  it.each([
    ['(11) 98765-4321', '11987654321'],
    ['+55 11 98765-4321', '11987654321'],
    ['5511987654321', '11987654321'],
    ['(11) 8765-4321', '11987654321'],
    ['(11) 3234-5678', '1132345678'],
  ])('grava %s como %s', async (entrada, canonico) => {
    const { dto, erroDeTelefone } = await montar(classe, base, entrada);
    expect(erroDeTelefone).toBeUndefined();
    expect(dto.phone).toBe(canonico);
  });

  it.each([
    ['12345'],
    ['119876543210'],
    ['(10) 98765-4321'],
    ['(11) 1234-5678'],
  ])('recusa %s', async (entrada) => {
    const { erroDeTelefone } = await montar(classe, base, entrada);
    expect(erroDeTelefone).toBeDefined();
  });
});

describe('telefone opcional', () => {
  it.each([UpdateProfileDto, UpdateCollaboratorDto])(
    '%p ignora telefone vazio em vez de gravar string vazia',
    async (classe) => {
      const { dto, erroDeTelefone } = await montar(classe, {}, '');
      expect(erroDeTelefone).toBeUndefined();
      expect(dto.phone).toBeUndefined();
    },
  );

  it('telefone vazio continua obrigatório no cadastro de colaborador', async () => {
    const { erroDeTelefone } = await montar(
      CreateCollaboratorDto,
      { name: 'Ana', email: 'ana@email.com' },
      '',
    );
    expect(erroDeTelefone).toBeDefined();
  });
});

describe('normalizarTelefoneDeUsuario', () => {
  it('mantém o valor bruto quando não dá para canonizar (o validador recusa)', () => {
    expect(normalizarTelefoneDeUsuario('12345')).toBe('12345');
  });

  it('não mexe em valor que não é string', () => {
    expect(normalizarTelefoneDeUsuario(11987654321)).toBe(11987654321);
    expect(normalizarTelefoneDeUsuario(null)).toBeNull();
  });
});
