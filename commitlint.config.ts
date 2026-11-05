import type { UserConfig } from '@commitlint/types';

// Conventional Commits em pt-BR (tech §2.5). O título do PR segue as mesmas regras.
const config: UserConfig = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      ['web', 'domain', 'nfce', 'db', 'sync', 'fn', 'pluggy', 'push', 'ci', 'docs', 'deps'],
    ],
    'header-max-length': [2, 'always', 100],
    'subject-full-stop': [2, 'never', '.'],
  },
};

export default config;
