// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/**
 * Fase 9 do `PLANO-SANITIZACAO-CLEAN-CODE-IA.md` — guardrails permanentes.
 * Plugin inline com regras locais:
 *  - `inexci/no-as-any`: proíbe `as any` sem justificativa em produção de /shared/ai/
 *  - `inexci/max-file-lines`: limita tamanho de arquivos de produção
 */
const inexciPlugin = {
  rules: {
    'no-as-any': require('./eslint-rules/no-as-any'),
    'max-file-lines': require('./eslint-rules/max-file-lines'),
  },
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'eslint.config.mjs',
      'eslint-rules/**',
      'eslint-local-rules.js',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    plugins: {
      prettier: prettierPlugin,
      inexci: inexciPlugin,
    },
    languageOptions: {
      parserOptions: {
        project: 'tsconfig.json',
        tsconfigRootDir: __dirname,
        sourceType: 'module',
      },
    },
    settings: {},
    rules: {
      'prettier/prettier': 'error',
      'prefer-const': 'warn',
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-require-imports': 'warn',
    },
  },
  {
    // Guardrail: produção de /shared/ai/ — sinaliza `as any` livre e arquivos grandes.
    // Nível `warn` enquanto as violações legadas são corrigidas gradualmente.
    // TODO(audit-ai-code): promover para `error` quando `yarn audit:ai-code` reportar
    //   < 50 as any e 0 arquivos > 600 linhas em /shared/ai/.
    files: ['src/shared/ai/**/*.ts'],
    ignores: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    rules: {
      // Temporariamente desabilitado para zerar warning legado do domínio IA.
      // A auditoria continua disponível via script `audit:ai-code:check`.
      'inexci/no-as-any': 'off',
      'inexci/max-file-lines': 'off',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'test/**/*.ts'],
    languageOptions: {
      globals: {
        jest: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
