import { paraCentavos, ValorMonetario } from './dinheiro';

const UNIDADES = [
  '',
  'um',
  'dois',
  'três',
  'quatro',
  'cinco',
  'seis',
  'sete',
  'oito',
  'nove',
  'dez',
  'onze',
  'doze',
  'treze',
  'quatorze',
  'quinze',
  'dezesseis',
  'dezessete',
  'dezoito',
  'dezenove',
];

const DEZENAS = [
  '',
  '',
  'vinte',
  'trinta',
  'quarenta',
  'cinquenta',
  'sessenta',
  'setenta',
  'oitenta',
  'noventa',
];

const CENTENAS = [
  '',
  'cento',
  'duzentos',
  'trezentos',
  'quatrocentos',
  'quinhentos',
  'seiscentos',
  'setecentos',
  'oitocentos',
  'novecentos',
];

const ESCALAS: { singular: string; plural: string }[] = [
  { singular: '', plural: '' },
  { singular: 'mil', plural: 'mil' },
  { singular: 'milhão', plural: 'milhões' },
  { singular: 'bilhão', plural: 'bilhões' },
];

function ateMil(numero: number): string {
  if (numero === 100) return 'cem';
  const centena = Math.floor(numero / 100);
  const resto = numero % 100;
  const partes: string[] = [];
  if (centena) partes.push(CENTENAS[centena]);
  if (resto < 20) {
    if (resto) partes.push(UNIDADES[resto]);
  } else {
    partes.push(DEZENAS[Math.floor(resto / 10)]);
    if (resto % 10) partes.push(UNIDADES[resto % 10]);
  }
  return partes.join(' e ');
}

function grupoPorExtenso(valor: number, escala: number): string {
  if (escala === 0) return ateMil(valor);
  if (escala === 1) return valor === 1 ? 'mil' : `${ateMil(valor)} mil`;
  const { singular, plural } = ESCALAS[escala];
  return `${ateMil(valor)} ${valor === 1 ? singular : plural}`;
}

export function inteiroPorExtenso(numero: number): string {
  if (!Number.isSafeInteger(numero) || numero < 0) {
    throw new Error(`Número inválido para extenso: ${numero}`);
  }
  if (numero === 0) return 'zero';

  const grupos: number[] = [];
  let restante = numero;
  while (restante > 0) {
    grupos.push(restante % 1000);
    restante = Math.floor(restante / 1000);
  }
  if (grupos.length > ESCALAS.length) {
    throw new Error(`Número grande demais para extenso: ${numero}`);
  }

  const presentes = grupos
    .map((valor, escala) => ({ valor, escala }))
    .filter(({ valor }) => valor > 0)
    .reverse();

  return presentes.reduce((texto, { valor, escala }, indice) => {
    const parte = grupoPorExtenso(valor, escala);
    if (indice === 0) return parte;
    const ultimo = indice === presentes.length - 1;
    if (ultimo && (valor < 100 || valor % 100 === 0)) {
      return `${texto} e ${parte}`;
    }
    const anterior = presentes[indice - 1];
    return `${texto}${anterior.escala >= 2 ? ',' : ''} ${parte}`;
  }, '');
}

export function valorPorExtenso(valor: ValorMonetario): string {
  const centavosTotais = paraCentavos(valor);
  if (centavosTotais < 0) {
    throw new Error(`Valor negativo não tem extenso de recibo: ${valor}`);
  }

  const reais = Math.floor(centavosTotais / 100);
  const centavos = centavosTotais % 100;

  if (reais === 0 && centavos === 0) return 'zero reais';

  const partes: string[] = [];
  if (reais > 0) {
    const texto = inteiroPorExtenso(reais);
    const redondoEmMilhao = reais >= 1_000_000 && reais % 1_000_000 === 0;
    const moeda = reais === 1 ? 'real' : redondoEmMilhao ? 'de reais' : 'reais';
    partes.push(`${texto} ${moeda}`);
  }
  if (centavos > 0) {
    partes.push(
      `${inteiroPorExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`,
    );
  }
  return partes.join(' e ');
}

export function formatarReais(valor: ValorMonetario): string {
  const centavos = paraCentavos(valor);
  const absoluto = Math.abs(centavos);
  const reais = Math.floor(absoluto / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const resto = String(absoluto % 100).padStart(2, '0');
  return `${centavos < 0 ? '-' : ''}R$ ${reais},${resto}`;
}
