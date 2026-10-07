/**
 * Modelos de documento costumam ser escritos como o documento inteiro —
 * título no topo e assinatura no fim (é assim que vêm do Feegow e é assim que
 * o médico escreve). O PDF já imprime o título no cabeçalho e a assinatura no
 * rodapé, então esses pedaços sairiam duplicados. Aqui saem só o título no
 * começo e o bloco de assinatura no fim; o meio fica intacto.
 */

const sem = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Títulos que o cabeçalho do PDF já imprime. */
const TITULOS = new Set(
  [
    'atestado',
    'atestado medico',
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
    // Linha de assinatura é curta; frase do corpo que cita o médico
    // ("Eu, Dr. Fulano, atesto…") não pode sumir.
    if (t.length > MAX_LINHA_ASSINATURA) return false;
    const n = sem(t);
    return (
      (nome !== '' && n.includes(nome)) ||
      (registro !== '' && n.includes(registro)) ||
      CONSELHO.test(n) ||
      TRATAMENTO.test(n) ||
      ASSINATURA.test(n)
    );
  };

  let fim = linhas.length;
  while (fim > inicio && daAssinatura(linhas[fim - 1])) fim--;

  const limpo = linhas.slice(inicio, fim).join('\n').trim();
  // Modelo que era só título e assinatura: melhor devolver como veio do que
  // apagar o texto do médico.
  return limpo || texto.trim();
}
