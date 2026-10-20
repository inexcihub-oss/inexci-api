const AFFIRMATIVE_PHRASES = new Set<string>([
  'sim',
  's',
  'sim!',
  'sim por favor',
  'sim, por favor',
  'sim por favor.',
  'sim claro',
  'sim, claro',
  'claro',
  'claro!',
  'pode',
  'pode sim',
  'pode mandar',
  'pode mandar ver',
  'manda',
  'manda ver',
  'manda bala',
  'mandar',
  'segue',
  'segue ai',
  'segue aí',
  'vai',
  'vai la',
  'vai lá',
  'vamos',
  'vamos la',
  'vamos lá',
  'confirmo',
  'confirmado',
  'confirma',
  'confirmar',
  'ok',
  'okay',
  'beleza',
  'blz',
  'show',
  'isso',
  'isso mesmo',
  'isso ai',
  'isso aí',
  'positivo',
  'afirmativo',
  'quero',
  'quero sim',
  'quero sim por favor',
  'aceito',
  'aceitar',
  'fechado',
  'feito',
  'bora',
  'bora la',
  'bora lá',
  'pode prosseguir',
  'prosseguir',
  'prossiga',
  'prossiga por favor',
  'sim pode',
  'sim, pode',
  'sim confirmo',
  'sim, confirmo',
  'pode seguir',
  'pode criar',
  'pode enviar',
  'pode registrar',
  'pode atualizar',
  'pode confirmar',
  'pode fazer',
  'correto',
  'certo',
  'perfeito',
  'tudo certo',
]);

const NEGATIVE_PHRASES = new Set<string>([
  'nao',
  'n',
  'nao, obrigado',
  'nao obrigado',
  'nao quero',
  'cancela',
  'cancelar',
  'cancele',
  'pare',
  'para',
  'desiste',
  'desistir',
  'esquece',
  'esquecer',
  'deixa',
  'deixa pra la',
  'deixa pra lá',
  'nada',
  'nada nao',
]);

export function normalizeConfirmationInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function matches(rawInput: string, phrases: ReadonlySet<string>): boolean {
  if (!rawInput) return false;
  const normalized = normalizeConfirmationInput(rawInput);
  if (!normalized || normalized.length > 60) return false;
  if (phrases.has(normalized)) return true;
  const semPontuacao = normalized.replace(/[\s.!?,;:]+$/u, '').trim();
  return !!semPontuacao && phrases.has(semPontuacao);
}

export function isAffirmativeConfirmation(rawInput: string): boolean {
  return matches(rawInput, AFFIRMATIVE_PHRASES);
}

export function isNegativeConfirmation(rawInput: string): boolean {
  return matches(rawInput, NEGATIVE_PHRASES);
}
