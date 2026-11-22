import parser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['app/assets/**', 'app/public/**', 'app/vendor/**'],
  },
  {
    files: ['app/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {parser, parserOptions: {ecmaFeatures: {jsx: true}}},
    plugins: {'react-hooks': reactHooks},
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
