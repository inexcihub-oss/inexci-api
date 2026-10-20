const sem = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const TITULOS = new Set(
  [
    'atestado',
    'atestado medico',
    'atestado odontologico',
    'atestado de comparecimento',
    'pedido de exame',
    'pedido de exames',
    'solicitacao de exame',
    'solicitacao de exames',
    'encaminhamento de exames',
    'requisicao de exame',
    'requisicao de exames',
    'pedido medico',
  ].map(sem),
);

const SEPARADOR = /^[\s\-_=*.~—–]{3,}$/;
const CONSELHO = /^(crm|crn|crp|coren|crefito|crfa|cro|crf|crbm|crbio)\b/i;
const TRATAMENTO = /^(dr|dra)\b/i;
const ASSINATURA = /^(assinatura|carimbo)\b/i;
const MAX_LINHA_ASSINATURA = 80;
const MAX_PALAVRAS_DE_NOME = 4;

const PALAVRA_FIXA =
  /^(dr|dra|e|a|o|da|de|do|das|dos|assinatura|carimbo|medico|medica|crm|crn|crp|coren|crefito|crfa|cro|crf|crbm|crbio)$/;

function soAssinatura(linha: string, nome: string, registro: string): boolean {
  if (/[!?]$/.test(linha) || /\p{L}{4,}\.$/u.test(linha)) return false;
  const doMedico = new Set(`${nome} ${registro}`.split(' ').filter(Boolean));
  let palavrasDeNome = 0;
  for (const token of linha.split(/[\s.,:;()/\-–—|_]+/)) {
    const t = sem(token);
    if (!t || /\d/.test(t) || doMedico.has(t) || PALAVRA_FIXA.test(t)) continue;
    if (/^\p{Lu}{2}$/u.test(token)) continue;
    if (!/^\p{Lu}/u.test(token)) return false;
    if (++palavrasDeNome > MAX_PALAVRAS_DE_NOME) return false;
  }
  return true;
}

export function limparTextoDoModelo(
  texto: string,
  medico: { nome?: string | null; registro?: string | null },
): string {
  const linhas = texto.replace(/\r\n?/g, '\n').split('\n');
  const vazia = (l: string) => l.trim() === '';

  let inicio = 0;
  while (inicio < linhas.length && vazia(linhas[inicio])) inicio++;
  if (inicio < linhas.length && TITULOS.has(sem(linhas[inicio]))) inicio++;

  const nome = medico.nome ? sem(medico.nome) : '';
  const registro = medico.registro ? sem(medico.registro) : '';
  const daAssinatura = (linha: string) => {
    const t = linha.trim();
    if (t === '' || SEPARADOR.test(t)) return true;
    if (t.length > MAX_LINHA_ASSINATURA) return false;
    const n = sem(t);
    const temSinal =
      (nome !== '' && n.includes(nome)) ||
      (registro !== '' && n.includes(registro)) ||
      CONSELHO.test(n) ||
      TRATAMENTO.test(n) ||
      ASSINATURA.test(n);
    return temSinal && soAssinatura(t, nome, registro);
  };

  let fim = linhas.length;
  while (fim > inicio && daAssinatura(linhas[fim - 1])) fim--;

  const limpo = linhas.slice(inicio, fim).join('\n').trim();
  return limpo || texto.trim();
}
