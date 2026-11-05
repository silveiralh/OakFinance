import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/app/App';
import { ptBR, t } from '../src/i18n/pt-BR';

describe('smoke do app', () => {
  it('US-03: a casca do app renderiza a marca tipográfica', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('OakFinance');
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
