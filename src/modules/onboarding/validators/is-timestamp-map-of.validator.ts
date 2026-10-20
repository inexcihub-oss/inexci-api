import {
  ValidationOptions,
  isISO8601,
  registerDecorator,
} from 'class-validator';

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
