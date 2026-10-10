'use strict';

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow `as any` without justification in production AI code',
      recommended: false,
    },
    messages: {
      noAsAny:
        'O uso de `as any` requer comentário de justificativa: ' +
        '// eslint-disable-next-line local-rules/no-as-any -- <motivo>',
    },
    schema: [],
  },
  create(context) {
    return {
      TSAsExpression(node) {
        if (
          node.typeAnnotation &&
          node.typeAnnotation.type === 'TSAnyKeyword'
        ) {
          context.report({ node, messageId: 'noAsAny' });
        }
      },
    };
  },
};
