import {
  ValidationOptions,
  isISO8601,
  registerDecorator,
} from 'class-validator';

/**
 * Valida um mapa `chave conhecida → timestamp ISO`.
 *
 * A coluna é `jsonb` e não tem schema no banco: se o DTO aceitasse qualquer
 * chave, um bug no frontend gravaria lixo permanente, sem caminho de limpeza.
 */
export function IsTimestampMapOf(
  allowed: readonly string[],
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isTimestampMapOf',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (
            typeof value !== 'object' ||
            value === null ||
            Array.isArray(value)
          ) {
            return false;
          }
          // `isISO8601`, não `Date.parse`: este último aceita "August 21, 2026"
          // e "2026-08-21" sem hora, é dependente de engine, e entregaria menos
          // do que o nome do campo e a mensagem de erro prometem. Os campos de
          // topo deste mesmo DTO usam `@IsISO8601()` — o mapa segue a regra.
          return Object.entries(value as Record<string, unknown>).every(
            ([chave, valor]) =>
              allowed.includes(chave) &&
              typeof valor === 'string' &&
              isISO8601(valor),
          );
        },
        defaultMessage() {
          return `${propertyName} aceita apenas as chaves conhecidas (${allowed.join(', ')}) com valor de data ISO`;
        },
      },
    });
  };
}
