import { render, screen } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from '../src/app/App';
import { appRoutes } from '../src/app/routes';
import { ptBR, t } from '../src/i18n/pt-BR';

describe('smoke do app', () => {
  it('US-03: a tela de boas-vindas renderiza a marca tipográfica', async () => {
    const router = createMemoryRouter(appRoutes(), { initialEntries: ['/boas-vindas'] });
    render(<App router={router} />);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('OakFinance');
  });

  it('textos de interface vêm do i18n sem "!" e sem emoji', () => {
    for (const texto of Object.values(ptBR)) {
      expect(texto).not.toMatch(/!|\p{Extended_Pictographic}/u);
    }
    expect(t('onb.welcome.title')).toBe('OakFinance');
  });

  it('a rede fica bloqueada nos testes', async () => {
    await expect(fetch('https://example.test/qualquer')).rejects.toThrow();
  });

  it('o IndexedDB em memória está disponível', () => {
    expect(globalThis.indexedDB).toBeDefined();
  });
});
