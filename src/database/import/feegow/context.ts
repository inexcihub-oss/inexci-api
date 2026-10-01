import { Ledger } from '../core/ledger';
import { Relatorio } from '../core/report';

/** Usuário que já existe no banco (de qualquer conta — e-mail é único global). */
export interface UsuarioExistente {
  id: string;
  ownerId: string;
  email: string;
  temPerfil: boolean;
}

/**
 * Tudo o que uma fase precisa para planejar, sem tocar no banco. Quem monta é
 * o runner: com banco, preenche os mapas a partir das tabelas; em `--sem-banco`
 * (dry-run sobre o export, sem conexão), deixa os mapas vazios.
 */
export interface ContextoImportacao {
  /** Dono da conta que recebe os dados (`users.id`, que também é o `owner_id`). */
  ownerId: string;
  /** "Hoje" da carga (`YYYY-MM-DD`) — separa consultas passadas de futuras. */
  hoje: string;
  /** Cópia de trabalho do ledger; só é salva se a gravação der certo. */
  ledger: Ledger;
  relatorio: Relatorio;
  novoId: () => string;
  /** Por e-mail em minúsculas, de todas as contas (`users.email` é único). */
  usuariosPorEmail: Map<string, UsuarioExistente>;
  /** Telefones de usuários vivos (`IDX_users_phone_unique`). */
  telefonesEmUso: Set<string>;
  /** Convênios já cadastrados na conta, por nome normalizado. */
  conveniosExistentes: Map<string, string>;
  /** `--mapear prof:8=email` / `func:2=email`: força o casamento com um usuário existente. */
  mapear: Map<string, string>;
  opcoes: {
    somenteComAtividade: boolean;
    /**
     * Consulta futura importada já sai como "lembrete enviado" (o Feegow já
     * lembrou ou vai lembrar); `--lembretes` deixa a INEXCI disparar o dela.
     */
    lembretes: boolean;
    /**
     * Consulta passada que ficou em agendada/confirmada/aguardando/em
     * atendimento sem atendimento registrado: `manter` (default, igual ao
     * Feegow), `completed` ou `no_show`.
     */
    passadasSemAtendimento: 'manter' | 'completed' | 'no_show';
  };
}

/** Nome comparável: sem acento, minúsculo, espaços colapsados. */
export function chaveDeNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
