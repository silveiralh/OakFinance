import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrandLogo, resolveLogoArt, ToastProvider, useToast } from '../../src/ui';
import { MONOGRAM_OF, WORDMARK_RATIO, WORDMARK_VIEWBOX } from '../../src/ui/brand-paths';
import { TOAST_MS, TOAST_WITH_ACTION_MS } from '../../src/ui/Toast';

const wrapper = ({ children }: { children: ReactNode }) => (
  <ToastProvider>{children}</ToastProvider>
);

describe('Toast (UX §5.22)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.removeAttribute('data-glass');
    document.documentElement.removeAttribute('data-theme');
  });

  it('fila de 1 por vez, 4 s sem ação e 8 s com ação, na região polite', () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    const region = screen.getByTestId('toast-region');
    expect(region).toHaveAttribute('aria-live', 'polite');
    act(() => {
      result.current({ message: 'Lançamento salvo.' });
      result.current({
        message: 'Lançamento excluído.',
        action: { label: 'Desfazer', onPress: () => {} },
      });
    });
    expect(region).toHaveTextContent('Lançamento salvo.');
    expect(region).not.toHaveTextContent('Lançamento excluído.');
    act(() => {
      vi.advanceTimersByTime(TOAST_MS - 1);
    });
    expect(region).toHaveTextContent('Lançamento salvo.');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(region).toHaveTextContent('Lançamento excluído.');
    act(() => {
      vi.advanceTimersByTime(TOAST_WITH_ACTION_MS - 1);
    });
    expect(region).toHaveTextContent('Lançamento excluído.');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(region).toHaveTextContent('');
  });

  it('pausa com o ponteiro ou o foco; a ação executa e fecha', () => {
    const onPress = vi.fn();
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      result.current({
        message: 'Lançamento excluído.',
        tone: 'info',
        action: { label: 'Desfazer', onPress },
      });
    });
    const region = screen.getByTestId('toast-region');
    fireEvent.pointerEnter(region);
    act(() => {
      vi.advanceTimersByTime(TOAST_WITH_ACTION_MS * 2);
    });
    expect(region).toHaveTextContent('Lançamento excluído.');
    fireEvent.pointerLeave(region);
    fireEvent.focus(screen.getByRole('button', { name: 'Desfazer' }));
    act(() => {
      vi.advanceTimersByTime(TOAST_WITH_ACTION_MS * 2);
    });
    expect(region).toHaveTextContent('Lançamento excluído.');
    fireEvent.blur(screen.getByRole('button', { name: 'Desfazer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(onPress).toHaveBeenCalled();
    expect(region).toHaveTextContent('');
  });

  it('duração infinita não some sozinha; fora do provider é erro', () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      result.current({
        message: 'Atualização disponível',
        tone: 'warning',
        duration: Number.POSITIVE_INFINITY,
      });
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByTestId('toast-region')).toHaveTextContent('Atualização disponível');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useToast())).toThrow('useToast fora do ToastProvider');
  });
});

describe('BrandLogo (UX §4.11, §5.35)', () => {
  it('UXA-013: monograma e favicon em quadrado preto com o "OF" lima, sem os azuis do Aero', () => {
    const { container } = render(
      <>
        <BrandLogo variant="monogram" height={48} data-testid="m" />
        <BrandLogo variant="monogram" height={20} data-testid="f" />
      </>,
    );
    const html = container.innerHTML;
    expect(screen.getByTestId('m').dataset.art).toBe('monogram');
    expect(screen.getByTestId('f').dataset.art).toBe('favicon');
    expect(html).toContain('#0B0D0A');
    expect(html).toContain('#C0E45C');
    expect(html).not.toMatch(/#0B76AE|#5CCFFF|#053F5F/i);
  });

  it.each([
    ['wordmark', 'wordmark', 32, false, 'wordmark'],
    ['wordmark', 'wordmark', 21, false, 'favicon'],
    ['wordmark', 'wordmark', 16, false, 'favicon'],
    ['wordmark-sheen', 'wordmark', 40, false, 'wordmark-sheen'],
    ['wordmark-sheen', 'wordmark', 31, false, 'wordmark'],
    ['wordmark-sheen', 'wordmark', 40, true, 'wordmark'],
    ['monogram', 'wordmark', 32, false, 'monogram'],
    ['monogram', 'wordmark', 24, false, 'favicon'],
    ['mono', 'wordmark', 24, false, 'mono-wordmark'],
    ['mono', 'wordmark', 20, false, 'mono-monogram'],
    ['mono', 'monogram', 64, false, 'mono-monogram'],
  ] as const)('%s/%s em %i px (sólido=%s) → %s', (variant, glyph, height, solid, art) => {
    expect(resolveLogoArt(variant, glyph, height, solid)).toBe(art);
  });

  it('role img com título "OakFinance"; decorativo fica oculto; ids únicos por instância', () => {
    render(
      <>
        <BrandLogo variant="wordmark-sheen" height={40} data-testid="a" />
        <BrandLogo variant="wordmark-sheen" height={40} data-testid="b" />
        <BrandLogo decorative data-testid="d" />
      </>,
    );
    expect(screen.getAllByRole('img', { name: 'OakFinance' })).toHaveLength(2);
    expect(screen.getByTestId('d')).toHaveAttribute('aria-hidden', 'true');
    const ids = [...document.querySelectorAll('title')].map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    // D-108: o desenho em contornos ocupa a altura toda (sem a folga do texto antigo)
    expect(screen.getByTestId('a')).toHaveAttribute(
      'width',
      String(Math.round(40 * WORDMARK_RATIO)),
    );
    expect(screen.getByTestId('a')).toHaveAttribute('viewBox', WORDMARK_VIEWBOX);
  });

  it('cores: tokens no automático; hex do tema quando forçado; sólido derruba o brilho', () => {
    const { rerender } = render(<BrandLogo data-testid="l" />);
    const paths = () => [...screen.getByTestId('l').querySelectorAll('path')];
    expect(paths().map((p) => p.getAttribute('fill'))).toEqual([
      'var(--brand-oak)',
      'var(--brand-finance)',
    ]);
    // D-108: "Oak" e "Finance" são contornos da Sora, não texto que depende da fonte carregar
    expect(screen.getByTestId('l').querySelector('text')).toBeNull();
    rerender(<BrandLogo theme="dark" data-testid="l" />);
    // UXA-013: o hex forçado é o do token de marca do escuro (névoa e lima)
    expect(paths().map((p) => p.getAttribute('fill'))).toEqual(['#F2F7EC', '#C0E45C']);
    document.documentElement.setAttribute('data-glass', 'solid');
    document.documentElement.setAttribute('data-theme', 'dark');
    rerender(<BrandLogo variant="wordmark-sheen" height={48} data-testid="l" />);
    expect(screen.getByTestId('l')).toHaveAttribute('data-art', 'wordmark');
    document.documentElement.removeAttribute('data-glass');
    rerender(<BrandLogo variant="wordmark-sheen" height={48} data-testid="l" />);
    // D-108: sem o brilho em degradê do Aero
    expect(screen.getByTestId('l').querySelector('stop')).toBeNull();
  });

  it('monograma, favicon e mono desenham o OF', () => {
    const { rerender } = render(<BrandLogo variant="monogram" height={48} data-testid="l" />);
    expect(screen.getByTestId('l')).toHaveAttribute('viewBox', '0 0 512 512');
    // D-108: o "OF" da Sora em lima sobre o quadrado preto
    expect(screen.getByTestId('l').querySelector('path')).toHaveAttribute('fill', '#C0E45C');
    expect(screen.getByTestId('l').querySelector('path')?.getAttribute('d')).toBe(MONOGRAM_OF);
    rerender(<BrandLogo variant="monogram" height={16} data-testid="l" />);
    expect(screen.getByTestId('l')).toHaveAttribute('viewBox', '0 0 32 32');
    rerender(<BrandLogo variant="mono" glyph="monogram" data-testid="l" />);
    expect(screen.getByTestId('l').querySelector('path')).toHaveAttribute('fill', 'currentColor');
    rerender(<BrandLogo variant="mono" height={32} data-testid="l" />);
    expect(
      [...screen.getByTestId('l').querySelectorAll('path')].map((p) => p.getAttribute('fill')),
    ).toEqual(['currentColor', 'currentColor']);
  });
});
