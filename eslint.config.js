import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { CONTEXTS, PERIPHERY } from './verification/rules/packages.js';
import { corePurityRules } from './verification/rules/purity.js';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'verification/fixtures/**', 'verification/surface/*.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // La cáscara y el arnés de verificación sí viven sobre una plataforma.
    files: [
      '*.js',
      '*.ts',
      'verification/**/*.{js,ts}',
      ...PERIPHERY.flatMap((pkg) => [`${pkg}/src/**/*.ts`, `${pkg}/test/**/*.ts`]),
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // Los cinco contextos: pureza del núcleo. `docs/diseno/verificacion.md` §2.4.
    files: CONTEXTS.flatMap((context) => [`${context}/src/**/*.ts`, `${context}/test/**/*.ts`]),
    rules: corePurityRules,
  },
);
