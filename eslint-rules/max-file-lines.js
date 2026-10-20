'use strict';

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Enforce maximum file line count',
      recommended: false,
    },
    messages: {
      tooManyLines:
        'O arquivo tem {{count}} linhas (máximo configurado: {{max}}). ' +
        'Considere extrair responsabilidades em arquivos menores.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          max: { type: 'number', minimum: 1 },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = context.options[0] || {};
    const max = typeof options.max === 'number' ? options.max : 400;

    return {
      Program(node) {
        const lines = context.getSourceCode
          ? context.getSourceCode().lines
          : context.sourceCode?.lines ?? [];
        const count = lines.length;
        if (count > max) {
          context.report({
            node,
            messageId: 'tooManyLines',
            data: { count, max },
          });
        }
      },
    };
  },
};
