/**
 * Regra ESLint local: `inexci/no-as-any`
 * Fase 9 do `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`.
 *
 * Proíbe `as any` na produção de `/shared/ai/`. Permite apenas com
 * comentário de justificativa:
 *   // eslint-disable-next-line local-rules/no-as-any -- <motivo>
 *
 * Aplicada com `error` em `src/shared/ai/**` (excluindo specs) e
 * `warn` no restante da base (via overrides em `.eslintrc.js`).
 */
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
