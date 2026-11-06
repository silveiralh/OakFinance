import { Bank, CheckCircle, ListBullets, Warning } from '@phosphor-icons/react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AppBackdrop,
  Badge,
  Banner,
  EmptyState,
  GlassCard,
  MoneyText,
  moneyLabel,
  Skeleton,
} from '../../src/ui';

afterEach(() => {
  document.documentElement.removeAttribute('data-values');
});

describe('MoneyText (UX §5.7, RN-103)', () => {
  it('receita com "+", rótulo para leitor de tela e ícone opcional', () => {
    render(<MoneyText value={1234} kind="income" showIcon data-testid="m" />);
    const el = screen.getByTestId('m');
    expect(el).toHaveTextContent('Receita de +R$ 12,34');
    expect(el).toHaveAttribute('data-kind', 'income');
    expect(el.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('despesa com o sinal de menos U+2212, nunca o hífen', () => {
    render(<MoneyText value={98000} kind="expense" data-testid="m" />);
    const text = screen.getByTestId('m').textContent ?? '';
    expect(text).toContain('−R$ 980,00');
    expect(text).not.toContain('-');
  });

  it('neutro mostra o próprio sinal; guardado e transferência sem sinal', () => {
    expect(moneyLabel(-150, 'neutral', false, false)).toBe('−R$ 1,50');
    expect(moneyLabel(150, 'saving', true, false)).toBe('R$ 1,50');
    expect(moneyLabel(150, 'transfer', true, false)).toBe('R$ 1,50');
    expect(moneyLabel(150, 'income', false, false)).toBe('R$ 1,50');
    expect(moneyLabel(-150, 'expense', true, false)).toBe('−R$ 1,50');
  });

  it('RN-103: com data-values="hidden" vira "R$ ••••" e lê "Valor oculto"', () => {
    document.documentElement.setAttribute('data-values', 'hidden');
    render(
      <>
        <MoneyText value={50000} kind="expense" size="hero" data-testid="oculto" />
        <MoneyText value={50000} hideable={false} data-testid="sempre" />
      </>,
    );
    const hidden = screen.getByTestId('oculto');
    expect(hidden).toHaveTextContent('R$ ••••');
    expect(hidden).toHaveTextContent('Valor oculto');
    expect(hidden).not.toHaveTextContent('500');
    expect(screen.getByTestId('sempre')).toHaveTextContent('R$ 500,00');
  });
});

describe('GlassCard (UX §5.4) e AppBackdrop (UX §5.5)', () => {
  it('título h2 (ou o nível pedido), ação no canto e tom com ícone', () => {
    const onPress = vi.fn();
    render(
      <GlassCard
        title="Faturas"
        tone="warning"
        action={{ label: 'Ver tudo', onPress }}
        data-testid="c"
      >
        conteúdo
      </GlassCard>,
    );
    const card = screen.getByTestId('c');
    expect(card.tagName).toBe('SECTION');
    expect(card).toHaveClass('glass');
    expect(card).toHaveAttribute('data-level', '2');
    expect(within(card).getByRole('heading', { level: 2, name: 'Faturas' })).toBeInTheDocument();
    expect(card.querySelector('h2 svg[aria-hidden="true"]')).not.toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Ver tudo' }));
    expect(onPress).toHaveBeenCalled();
  });

  it('variações: li, h3, link de ação, tom sem título, carregando', () => {
    const { rerender } = render(
      <ul>
        <GlassCard
          as="li"
          title="Item"
          headingLevel={3}
          action={{ label: 'Abrir', href: '/x' }}
          level={1}
          padding="lg"
          data-testid="c"
        />
      </ul>,
    );
    expect(screen.getByTestId('c').tagName).toBe('LI');
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Item');
    expect(screen.getByRole('link', { name: 'Abrir' })).toHaveAttribute('href', '/x');
    rerender(<GlassCard tone="success" loading data-testid="c" />);
    const card = screen.getByTestId('c');
    expect(card).toHaveAttribute('aria-busy', 'true');
    expect(card).toHaveTextContent('Carregando');
    expect(card.querySelector(':scope > svg')).not.toBeNull();
  });

  it('interativo vira botão ou link inteiro', () => {
    const onPress = vi.fn();
    const { rerender } = render(
      <GlassCard interactive={{ onPress }} title="Reserva" tone="info" />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Reserva/ }));
    expect(onPress).toHaveBeenCalled();
    rerender(<GlassCard interactive={{ href: '/planejar/reserva' }}>Reserva</GlassCard>);
    expect(screen.getByRole('link', { name: 'Reserva' })).toHaveAttribute(
      'href',
      '/planejar/reserva',
    );
  });

  it('o fundo é decorativo e estático', () => {
    render(<AppBackdrop />);
    expect(screen.getByTestId('app-backdrop')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('Badge, Skeleton, EmptyState e Banner', () => {
  it('Badge sempre com ícone e texto (UX §5.34)', () => {
    render(<Badge tone="danger" icon={Warning} label="Venceu ontem" data-testid="b" />);
    const badge = screen.getByTestId('b');
    expect(badge).toHaveTextContent('Venceu ontem');
    expect(badge).toHaveAttribute('data-tone', 'danger');
    expect(badge.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('Skeleton: aria-busy, "Carregando" e o número de linhas (UX §5.26)', () => {
    const { rerender } = render(<Skeleton lines={3} data-testid="s" />);
    const s = screen.getByTestId('s');
    expect(s).toHaveAttribute('aria-busy', 'true');
    expect(s).toHaveTextContent('Carregando');
    expect(s.querySelectorAll('.skeleton')).toHaveLength(3);
    rerender(<Skeleton shape="card" lines={5} data-testid="s" />);
    expect(screen.getByTestId('s').querySelectorAll('.skeleton')).toHaveLength(1);
  });

  it('EmptyState com título h2, texto e ações (UX §5.25 e §6.5)', () => {
    const primary = vi.fn();
    const secondary = vi.fn();
    render(
      <EmptyState
        icon={Bank}
        title="Nenhum banco conectado"
        description="Conecte o BB ou o Nubank para receber lançamentos automaticamente."
        primaryAction={{ label: 'Conectar banco', onPress: primary }}
        secondaryAction={{ label: 'Importar extrato', onPress: secondary }}
      />,
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Nenhum banco conectado' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Conectar banco' }));
    fireEvent.click(screen.getByRole('button', { name: 'Importar extrato' }));
    expect(primary).toHaveBeenCalled();
    expect(secondary).toHaveBeenCalled();
  });

  it('EmptyState de erro é alerta', () => {
    render(
      <EmptyState variant="error" icon={ListBullets} title="Erro" description="Tente de novo." />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Erro');
  });

  it('Banner: status (info), alerta com ação, botão Fechar (UX §5.23)', () => {
    const onDismiss = vi.fn();
    const onPress = vi.fn();
    const { rerender } = render(
      <Banner icon={CheckCircle} message="Tudo certo." onDismiss={onDismiss} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Tudo certo.');
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onDismiss).toHaveBeenCalled();
    rerender(
      <Banner
        tone="warning"
        icon={Warning}
        message="A conexão expira em 3 dias."
        action={{ label: 'Renovar', onPress }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('A conexão expira em 3 dias.');
    fireEvent.click(screen.getByRole('button', { name: 'Renovar' }));
    expect(onPress).toHaveBeenCalled();
    rerender(<Banner tone="warning" icon={Warning} message="Sem ação." />);
    expect(screen.getByRole('status')).toHaveTextContent('Sem ação.');
  });
});
