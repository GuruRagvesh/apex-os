import coreWebVitals from 'eslint-config-next/core-web-vitals';

// Next.js 16 removed `next lint`; ESLint runs directly with this flat config.
const config = [
  ...coreWebVitals,
  {
    rules: {
      'react/no-unescaped-entities': 'off',
      '@next/next/no-img-element': 'warn',
    },
  },
];

export default config;
