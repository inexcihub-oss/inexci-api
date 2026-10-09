import { LinhaCsv } from '../../core/csv';
import { Ledger } from '../../core/ledger';
import { Relatorio } from '../../core/report';
import { ContextoImportacao } from '../context';
import { ExportFeegow } from '../export';

export const OWNER = 'owner-uuid';

type Tabelas = Record<string, Partial<Record<string, string | null>>[]>;

export function exportSintetico(sobrescrever: Tabelas = {}): ExportFeegow {
  const tabelas: Tabelas = {
    unidades: [
      {
        id: '0',
        nome_fantasia: 'Clínica Exemplo',
        cnpj: '12.345.678/0001-90',
        email1: 'contato@exemplo.com',
        tel1: '2433334444',
        cep: '25600000',
        endereco: 'Rua A',
        numero: '10',
        bairro: 'Centro',
        cidade: 'Petrópolis',
        estado: 'RJ',
      },
    ],
    grade_fixa: [
      {
        dia_semana: '2',
        hora_de: '08:00:00',
        hora_ate: '12:00:00',
        fim_vigencia: null,
      },
      {
        dia_semana: '2',
        hora_de: '11:00:00',
        hora_ate: '16:00:00',
        fim_vigencia: null,
      },
      {
        dia_semana: '4',
        hora_de: '09:00:00',
        hora_ate: '12:00:00',
        fim_vigencia: '2020-01-01',
      },
    ],
    conselhos_profissionais: [
      { id: '1', codigo: 'CRM' },
      { id: '8', codigo: 'CRN' },
    ],
    especialidades: [
      { id: '129', nome_especialidade: 'Ortopedia e Traumatologia' },
      { id: '167', nome_especialidade: 'Nutrição' },
    ],
    profissional_especialidades: [
      { profissional_id: '1', especialidade_id: '129' },
      { profissional_id: '4', especialidade_id: '167' },
    ],
    profissionais: [
      prof('1', 'Dono Médico', '1', '12345', 'dono@exemplo.com', '24999990001'),
      prof('4', 'Ana Nutri', '8', null, 'ana@exemplo.com', '24999990004'),
      prof('9', 'Bia Técnica', '0', null, 'bia@exemplo.com', '24999990009'),
    ],
    funcionarios: [
      func('2', 'Carla Secretária', 'carla@exemplo.com', '24999990002'),
      func('1', 'Sem Email', null, null),
    ],
    usuarios: [
      {
        id: '173',
        tipo_usuario: 'Funcionarios',
        id_relativo: '2',
        permissoes: '|agendaV|, |usuariosA|',
      },
    ],
    convenios: [
      { id: '14', nome: 'UNIMED', sys_active: '-1' },
      { id: '15', nome: 'unimed', sys_active: '1' },
      { id: '5', nome: 'CONSULTA PARTICULAR CONSULTORIO', sys_active: '-1' },
      { id: '8', nome: 'GOLDEN CROSS', sys_active: '-1' },
      { id: '99', nome: 'NUNCA USADO', sys_active: '1' },
    ],
    pacientes: [
      pac('10', 'Maria Silva', '529.982.247-25', '1'),
      pac('11', 'João Souza', '11111111111', '1', {
        celular: null,
        fixo_1: '2422334455',
        celular_2: '24988887777',
      }),
      pac('12', 'Excluído', null, '-1'),
      pac('13', 'maria  silva', null, '0'),
    ],
    paciente_endereco: [
      {
        paciente_id: '10',
        cep: '25600000',
        logradouro: 'Rua B',
        numero: '5',
        bairro: 'Centro',
        cidade: 'Petrópolis',
        estado: 'Selecione',
      },
    ],
    locais: [
      { id: '1', NomeLocal: 'Consultório 01', sys_active: '1' },
      { id: '2', NomeLocal: 'Consultório 02', sys_active: '1' },
      { id: '4', NomeLocal: 'Hospital (excluído)', sys_active: '-1' },
    ],
    agendamento_status: [
      { id: '1', nome_status: 'Marcado - não confirmado' },
      { id: '3', nome_status: 'Atendido' },
      { id: '4', nome_status: 'Aguardando' },
      { id: '11', nome_status: 'Desmarcado pelo paciente' },
    ],
    agendamento_canais: [{ id: '-1', nome_canal: 'Doctoralia' }],
    paciente_convenio: [
      { paciente_id: '10', convenio_id1: '15', matricula1: 'ABC123' },
    ],
    agendamentos: [
      ag('10', '4', '2025-01-10', '8'),
      ag('10', '4', '2025-02-10', '15'),
      ag('10', '1', '2025-03-10', '0'),
      ag('11', '9', '2025-03-10', '5'),
      ag('11', '9', '2024-01-01', '14'),
    ],
    ...sobrescrever,
  };
  return new ExportFeegow(null, tabelas as Record<string, LinhaCsv[]>);
}

export function contextoDeTeste(
  parcial: Partial<ContextoImportacao> = {},
): ContextoImportacao {
  let n = 0;
  return {
    ownerId: OWNER,
    hoje: '2026-09-26',
    ledger: new Ledger(null),
    relatorio: new Relatorio('teste'),
    novoId: () => `id-${++n}`,
    usuariosPorEmail: new Map(),
    telefonesEmUso: new Set(),
    conveniosExistentes: new Map(),
    consultasComFicha: new Set(),
    mapear: new Map(),
    opcoes: {
      somenteComAtividade: false,
      semLembretes: false,
      donoNaoProfissional: false,
      passadasSemAtendimento: 'manter',
      caixaLivre: 'anamnesis',
      incluirRascunhos: false,
      modelosVazios: false,
      bloqueiosSoFuturos: false,
    },
    ...parcial,
  };
}

function prof(
  id: string,
  nome: string,
  conselho: string,
  doc: string | null,
  email: string | null,
  cel: string | null,
) {
  return {
    id,
    nome_profissional: nome,
    conselho_id: conselho,
    documento_conselho: doc,
    email1: email,
    celular1: cel,
    cpf: null,
    sexo_id: '1',
    nascimento: '1980-01-01',
    ativo: 'on',
    sys_active: '1',
  };
}

function func(
  id: string,
  nome: string,
  email: string | null,
  cel: string | null,
) {
  return {
    id,
    nome_funcionario: nome,
    email,
    celular: cel,
    cpf: null,
    sexo_id: '2',
    ativo: 'on',
    sys_active: '1',
  };
}

function pac(
  id: string,
  nome: string,
  cpf: string | null,
  ativo: string,
  extra: object = {},
) {
  return {
    id,
    nome_paciente: nome,
    cpf,
    celular: '24999991234',
    sexo: '2',
    nascimento: '1990-05-02',
    sys_active: ativo,
    sys_date: '2023-01-12 00:00:00',
    ...extra,
  };
}

export function ag(
  paciente: string | null,
  prof: string,
  data: string,
  convenio: string,
  extra: Record<string, string | null> = {},
) {
  return {
    id: `${paciente ?? 'x'}-${prof}-${data}`,
    paciente_id: paciente,
    profissional_id: prof,
    Data: data,
    Hora: '09:00:00',
    convenio_id: convenio,
    status_id: '3',
    tempo: '30',
    local_id: '1',
    usuario_id: '0',
    sys_date: '2024-12-01 10:00:00',
    sys_active: '1',
    ...extra,
  };
}
