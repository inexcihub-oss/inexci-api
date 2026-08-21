import { ValidationOptions, registerDecorator } from 'class-validator';

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
          return Object.entries(value as Record<string, unknown>).every(
            ([chave, valor]) =>
              allowed.includes(chave) &&
              typeof valor === 'string' &&
              !Number.isNaN(Date.parse(valor)),
          );
        },
        defaultMessage() {
          return `${propertyName} aceita apenas as chaves conhecidas (${allowed.join(', ')}) com valor de data ISO`;
        },
      },
    });
  };
}
