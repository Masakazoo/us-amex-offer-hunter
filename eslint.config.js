import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'runs/**',
      'chrome-devtools-mcp/**',
      '.venv/**',
      '**/__pycache__/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
