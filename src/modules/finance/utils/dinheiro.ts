const DECIMAL = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

export type ValorMonetario = string | number | null | undefined;

export function paraCentavos(valor: ValorMonetario): number {
  if (valor === null || valor === undefined) return 0;

  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) {
      throw new Error(`Valor monetário inválido: ${valor}`);
    }
    return Math.round(valor * 100);
  }

  const texto = valor.trim();
  if (texto === '') return 0;

  const partes = DECIMAL.exec(texto);
  if (!partes) throw new Error(`Valor monetário inválido: ${valor}`);

  const [, sinal, inteiro, fracao = ''] = partes;
  const centavos = Number(inteiro) * 100 + Number(fracao.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(centavos)) {
    throw new Error(`Valor monetário fora do limite: ${valor}`);
  }
  return sinal && centavos !== 0 ? -centavos : centavos;
}

export function deCentavos(centavos: number): string {
  if (!Number.isSafeInteger(centavos)) {
    throw new Error(`Centavos devem ser inteiros: ${centavos}`);
  }
  const absoluto = Math.abs(centavos);
  const reais = Math.floor(absoluto / 100);
  const resto = String(absoluto % 100).padStart(2, '0');
  return `${centavos < 0 ? '-' : ''}${reais}.${resto}`;
}

export function normalizarValor(valor: ValorMonetario): string {
  return deCentavos(paraCentavos(valor));
}

export function somar(...valores: ValorMonetario[]): string {
  return deCentavos(
    valores.reduce<number>((total, valor) => total + paraCentavos(valor), 0),
  );
}

export function subtrair(
  valor: ValorMonetario,
  ...descontos: ValorMonetario[]
): string {
  return deCentavos(
    descontos.reduce<number>(
      (total, desconto) => total - paraCentavos(desconto),
      paraCentavos(valor),
    ),
  );
}

export function multiplicar(valor: ValorMonetario, quantidade: number): string {
  if (!Number.isInteger(quantidade)) {
    throw new Error(`Quantidade deve ser inteira: ${quantidade}`);
  }
  return deCentavos(paraCentavos(valor) * quantidade);
}

export function compararValores(a: ValorMonetario, b: ValorMonetario): number {
  return Math.sign(paraCentavos(a) - paraCentavos(b));
}

export function ehPositivo(valor: ValorMonetario): boolean {
  return paraCentavos(valor) > 0;
}

export const LIMITE_NUMERIC_12_2_EM_CENTAVOS = 999_999_999_999;

export function totalDoItem(item: {
  unitAmount: ValorMonetario;
  quantity?: number | null;
  discount?: ValorMonetario;
  surcharge?: ValorMonetario;
}): string {
  return subtrair(
    somar(multiplicar(item.unitAmount, item.quantity ?? 1), item.surcharge),
    item.discount,
  );
}

export function cabeEmNumeric12x2(valor: ValorMonetario): boolean {
  return Math.abs(paraCentavos(valor)) <= LIMITE_NUMERIC_12_2_EM_CENTAVOS;
}
