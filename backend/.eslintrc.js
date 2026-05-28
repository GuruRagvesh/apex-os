module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    sourceType: 'module',
  },
  root: true,
  env: {
    node: true,
    jest: true,
  },
  rules: {
    'no-unused-vars': 'warn',
    'no-console': 'off',
  },
};
