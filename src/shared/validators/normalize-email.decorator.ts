import { Transform } from 'class-transformer';

export function normalizarEmail(valor: string): string;
export function normalizarEmail(
  valor: string | null | undefined,
): string | null | undefined;
export function normalizarEmail(
  valor: string | null | undefined,
): string | null | undefined {
  return typeof valor === 'string' ? valor.trim().toLowerCase() : valor;
}

export function NormalizeEmail(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizarEmail(value) : value,
  );
}
