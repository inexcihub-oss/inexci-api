import { Ledger } from '../core/ledger';
import { Relatorio } from '../core/report';

export interface UsuarioExistente {
  id: string;
  ownerId: string;
  email: string;
  temPerfil: boolean;
  excluido?: boolean;
}

export interface ContextoImportacao {
  ownerId: string;
  hoje: string;
  ledger: Ledger;
  relatorio: Relatorio;
  novoId: () => string;
  usuariosPorEmail: Map<string, UsuarioExistente>;
  telefonesEmUso: Set<string>;
  consultasComFicha: Set<string>;
  conveniosExistentes: Map<string, string>;
  mapear: Map<string, string>;
  opcoes: {
    somenteComAtividade: boolean;
    semLembretes: boolean;
    donoNaoProfissional: boolean;
    passadasSemAtendimento: 'manter' | 'completed' | 'no_show';
    caixaLivre: 'anamnesis' | 'conduct';
    incluirRascunhos: boolean;
    modelosVazios: boolean;
    bloqueiosSoFuturos: boolean;
  };
}

export function chaveDeNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
