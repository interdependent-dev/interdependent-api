import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['node_modules/', '.fredrin/'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          // `const { secret, ...rest } = row` — omit-fields destructuring
          ignoreRestSiblings: true,
        },
      ],
      // Intentionally empty `catch {}` blocks (best-effort cleanup paths)
      'no-empty': ['error', { allowEmptyCatch: true }],
      // LLM prompt template literals carry pasted typographic spaces
      'no-irregular-whitespace': ['error', { skipTemplates: true }],
    },
  },
  prettier,
];
