import { act, fireEvent, render, screen } from '@testing-library/react';
import { House, ShoppingCart } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BudgetRing,
  detectInstallVariant,
  GoalProgress,
  InstallGuide,
  InvoiceCard,
  InvoiceMini,
  invoiceBadge,
  PaceIndicator,
  ProgressBar,
  paceText,
  percentOf,
  type RowTx,
  ringLabel,
  rowLabel,
  SyncBadge,
  syncLabel,
  TabBar,
  TopBar,
  TransactionRow,
} from '../../src/ui';
import { SYNCED_HIDE_MS } from '../../src/ui/SyncBadge';

afterEach(() => {
  document.documentElement.removeAttribute('data-values');
  vi.useRealTimers();
});

describe('PaceIndicator (UX §5.6, RN-50)', () => {
  it.each([
    ['on_track', 0, 'No ritmo do mês'],
    ['attention', 30000, 'Atenção: restam R$\u00A0300,00'],
    ['attention', 0, 'No limite do planejado'],
    ['over', 4500, 'Acima do planejado em R$\u00A045,00'],
    ['no_income', 0, 'Cadastre a renda para calcular'],
  ] as const)('RN-50: %s (%i) → "%s"', (state, cents, text) => {
    expect(paceText(state, cents, false)).toBe(text);
    render(<PaceIndicator state={state} amountCents={cents} data-testid="p" />);
    const el = screen.getByRole('status');
    // o toHaveTextContent normaliza o U+00A0 do valor (T-130) só no texto lido
    expect(el).toHaveTextContent(`Status do mês: ${text.replace('\u00A0', ' ')}`);
    expect(el.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('RN-50/RN-103: com valores ocultos o estado continua visível; toque abre o detalhe', () => {
    document.documentElement.setAttribute('data-values', 'hidden');
    const onPress = vi.fn();
    render(<PaceIndicator state="over" amountCents={4500} onPress={onPress} />);
    expect(screen.getByRole('status')).toHaveTextContent('Acima do planejado em R$ ••••');
    fireEvent.click(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalled();
  });
});

describe('ProgressBar, BudgetRing e GoalProgress (UX §5.15–5.17)', () => {
  it('ProgressBar: papel, valores, excedente e indeterminada', () => {
    const { rerender } = render(
      <ProgressBar label="Mercado" valueCents={150} maxCents={100} ticks={[0.5]} />,
    );
    const bar = screen.getByRole('progressbar', { name: 'Mercado' });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(bar).toHaveAttribute('aria-valuetext', '150%');
    expect(bar).toHaveAttribute('data-over', 'true');
    rerender(<ProgressBar label="Carregando" valueCents={0} maxCents={0} indeterminate />);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(percentOf(1, 0)).toBe(0);
  });

  it('BudgetRing: rótulo gerado, tabela, alerta ≥ 80% e excedente com hachura', () => {
    const bands = [
      { key: 'savings', spentCents: 24000, plannedCents: 96000 },
      { key: 'needs', spentCents: 127200, plannedCents: 240000 },
      { key: 'wants', spentCents: 148500, plannedCents: 144000 },
    ] as const;
    const { container } = render(<BudgetRing bands={bands} incomeCents={480000} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Necessidades 53% de R$\u00A02.400,00; Desejos 103% de R$\u00A01.440,00; Poupança 25% de R$\u00A0960,00',
    );
    expect(screen.getByRole('table')).toHaveTextContent('R$ 45,00 acima do planejado');
    expect(container.querySelectorAll('[data-excess="true"]')).toHaveLength(1);
    expect(screen.getByRole('rowheader', { name: 'Desejos' }).querySelector('svg')).not.toBeNull();
    expect(ringLabel([{ key: 'needs', spentCents: 1, plannedCents: 0 }], true)).toBe(
      'Necessidades 0% de R$\u00A0••••',
    );
  });

  it('BudgetRing pequeno sem legenda', () => {
    render(<BudgetRing size="sm" bands={[]} incomeCents={0} />);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('GoalProgress: progresso, meta atingida, sem meta e barra', () => {
    const { rerender } = render(<GoalProgress savedCents={720000} goalCents={1440000} />);
    const ring = screen.getByRole('progressbar', { name: 'Poupança' });
    expect(ring).toHaveAttribute('aria-valuenow', '50');
    expect(ring).toHaveAttribute('aria-valuetext', '50%, R$\u00A07.200,00 de R$\u00A014.400,00');
    rerender(<GoalProgress savedCents={1500000} goalCents={1440000} size="sm" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      expect.stringContaining('Meta atingida'),
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-state', 'reached');
    rerender(<GoalProgress savedCents={0} goalCents={null} variant="bar" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Defina uma meta');
    expect(screen.getByText('Defina uma meta')).toBeInTheDocument();
    rerender(<GoalProgress savedCents={-5} goalCents={100} variant="bar" showLabel={false} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    rerender(<GoalProgress savedCents={100} goalCents={100} variant="bar" />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});

describe('InvoiceCard (UX §5.18)', () => {
  const invoice = {
    month: '2026-12',
    totalCents: 98000,
    remainingCents: 68000,
    closesOn: '2026-12-03',
    dueOn: '2026-12-10',
    status: 'closed' as const,
  };

  it.each([
    ['open', undefined, 'Aberta'],
    ['closed', 10, 'Fechada'],
    ['closed', 2, 'Vence em 2 dias'],
    ['partial', 0, 'Vence hoje'],
    ['partial', 9, 'Parcialmente paga'],
    ['paid', undefined, 'Paga'],
    ['overdue', undefined, 'Venceu'],
    ['future', undefined, 'Futura'],
  ] as const)('selo %s (%s dias) → "%s"', (status, days, label) => {
    expect(invoiceBadge(status, days).label).toBe(label);
  });

  it('cartão com selo, total, limite e datas; botão quando navega', () => {
    const onPress = vi.fn();
    const { rerender } = render(
      <InvoiceCard
        card={{ name: 'Nubank', brandColor: 'violet', last4: '0000' }}
        invoice={invoice}
        daysToDue={2}
        limitCents={500000}
        usedCents={98000}
        data-testid="c"
      />,
    );
    const card = screen.getByTestId('c');
    expect(card.tagName).toBe('ARTICLE');
    expect(card).toHaveTextContent('Vence em 2 dias');
    expect(card).toHaveTextContent('R$ 980,00');
    // T-123 (UXB-011): as datas com rótulo
    expect(card).toHaveTextContent('Fecha em 03/12 · Vence em 10/12');
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    rerender(
      <InvoiceCard
        card={{ name: 'Nubank', brandColor: 'aqua' }}
        invoice={{ ...invoice, status: 'partial' }}
        onPress={onPress}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalled();
    expect(screen.getByRole('button')).toHaveTextContent('R$ 680,00');
  });

  it('InvoiceMini e valores ocultos', () => {
    document.documentElement.setAttribute('data-values', 'hidden');
    render(
      <InvoiceMini
        cardName="Nubank"
        dueLabel="vence sex, 10/11"
        amountCents={124030}
        data-testid="m"
      />,
    );
    expect(screen.getByTestId('m')).toHaveTextContent('Nubank · vence sex, 10/11 · R$ ••••');
  });
});

const TX: RowTx = {
  id: 't1',
  kind: 'expense',
  amountCents: 3290,
  description: 'Padaria',
  category: { name: 'Mercado', icon: ShoppingCart, band: 'needs' },
  method: 'Nubank crédito',
  when: 'hoje 14:32',
  installment: { n: 3, total: 10 },
  syncState: 'pending',
};

describe('TransactionRow (UX §5.19)', () => {
  it('rótulo completo e selos sempre com texto', () => {
    const onPress = vi.fn();
    const onActions = vi.fn();
    render(
      <TransactionRow
        tx={{ ...TX, state: 'forecast', needsReview: true, linked: true }}
        onPress={onPress}
        onActions={onActions}
      />,
    );
    const main = screen.getByRole('button', {
      name: 'Despesa de −R$\u00A032,90, Padaria, Mercado, Nubank crédito, parcela 3 de 10, hoje 14:32, Prevista, Conferir, Vinculado, não sincronizado',
    });
    expect(main).toHaveTextContent('Prevista');
    expect(main).toHaveTextContent('Não sincronizado');
    fireEvent.click(main);
    fireEvent.click(screen.getByRole('button', { name: 'Ações' }));
    expect(onPress).toHaveBeenCalled();
    expect(onActions).toHaveBeenCalled();
  });

  it('cancelada riscada; sem descrição usa a categoria; receita com "+"; oculto', () => {
    const { rerender } = render(
      <TransactionRow tx={{ ...TX, state: 'cancelled' }} data-testid="r" density="compact" />,
    );
    expect(screen.getByTestId('r').querySelector('[data-cancelled="true"]')).not.toBeNull();
    const income: RowTx = { ...TX, kind: 'income', description: '', syncState: 'synced' };
    delete (income as Partial<RowTx>).installment;
    rerender(<TransactionRow tx={income} />);
    expect(screen.getByRole('button')).toHaveAccessibleName(
      'Receita de +R$\u00A032,90, Mercado, Nubank crédito, hoje 14:32',
    );
    expect(rowLabel({ ...TX, kind: 'saving' }, true)).toContain('Guardado R$\u00A0••••');
    expect(rowLabel({ ...TX, kind: 'transfer', syncState: 'synced' }, false)).toContain(
      'Transferência de R$\u00A032,90',
    );
  });
});

describe('SyncBadge (UX §5.24)', () => {
  it.each([
    ['synced', 0, 'Sincronizado'],
    ['syncing', 0, 'Sincronizando'],
    ['pending', 3, '3 lançamentos salvos neste aparelho'],
    ['offline', 3, 'Offline, 3 lançamentos salvos neste aparelho'],
    ['offline', 0, 'Offline'],
    ['error', 2, 'Não sincronizado, 2 lançamentos salvos neste aparelho'],
    ['error', 0, 'Não sincronizado'],
  ] as const)('%s (%i) → "%s"', (state, n, label) => {
    expect(syncLabel(state, n)).toBe(label);
  });

  it('anuncia offline e erro, e a volta ao sincronizado após erro; some 2 s depois de sincronizar', () => {
    vi.useFakeTimers();
    const onPress = vi.fn();
    const { rerender, container } = render(
      <SyncBadge state="pending" pendingCount={3} onPress={onPress} />,
    );
    const live = () => container.querySelector('[aria-live="polite"]');
    expect(live()).toHaveTextContent('');
    fireEvent.click(screen.getByRole('button', { name: '3 lançamentos salvos neste aparelho' }));
    expect(onPress).toHaveBeenCalled();
    rerender(<SyncBadge state="offline" pendingCount={3} />);
    expect(live()).toHaveTextContent('Offline, 3 lançamentos salvos neste aparelho');
    rerender(<SyncBadge state="error" pendingCount={3} />);
    expect(live()).toHaveTextContent('Não sincronizado');
    rerender(<SyncBadge state="synced" />);
    expect(live()).toHaveTextContent('Sincronizado');
    act(() => {
      vi.advanceTimersByTime(SYNCED_HIDE_MS);
    });
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<SyncBadge state="syncing" />);
    expect(screen.getByRole('button', { name: 'Sincronizando' })).toBeInTheDocument();
    expect(live()).toHaveTextContent('');
  });
});

describe('TopBar e TabBar (UX §5.33)', () => {
  it('TopBar: título h1, "Voltar" e transparência até rolar', () => {
    const onBack = vi.fn();
    render(<TopBar title="Lançamentos" onBack={onBack} transparentUntilScroll data-testid="t" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Lançamentos' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(onBack).toHaveBeenCalled();
    expect(screen.getByTestId('t')).toHaveAttribute('data-transparent', 'true');
    Object.defineProperty(window, 'scrollY', { value: 120, configurable: true });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(screen.getByTestId('t')).toHaveAttribute('data-transparent', 'false');
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });

  it('TabBar: <nav> com aria-current, rótulos visíveis, selo e slot central', () => {
    const onNavigate = vi.fn();
    const items = [
      { key: 'home', label: 'Início', icon: House, href: '/' },
      { key: 'list', label: 'Lançamentos', icon: ShoppingCart, href: '/lancamentos', badge: 2 },
    ];
    const { rerender } = render(
      <TabBar items={items} activeKey="home" center={<span>FAB</span>} onNavigate={onNavigate} />,
    );
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' });
    expect(screen.getByRole('link', { name: 'Início' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Lançamentos/ })).not.toHaveAttribute('aria-current');
    expect(nav).toHaveTextContent('FAB');
    fireEvent.click(screen.getByRole('link', { name: /Lançamentos/ }));
    expect(onNavigate).toHaveBeenCalledWith('/lancamentos');
    rerender(<TabBar items={items} activeKey="list" />);
    expect(screen.getByRole('link', { name: /Lançamentos/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe('InstallGuide (UX §5.27)', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Version/18.1 Safari', false, 'ios-17'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Version/26.0 Safari', false, 'ios-26'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) CriOS/130', false, 'ios-thirdparty'],
    ['Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile', false, 'android-chrome'],
    ['Mozilla/5.0 (Linux; Android 14) SamsungBrowser/26 Chrome/130', false, 'android-samsung'],
    ['Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile', true, 'android-prompt'],
    ['Mozilla/5.0 (X11; Linux x86_64) Chrome/130', true, 'desktop-prompt'],
    ['Mozilla/5.0 (X11; Linux x86_64) Firefox/130', false, 'desktop-manual'],
  ] as const)('%s (prompt=%s) → %s', (ua, prompt, variant) => {
    expect(detectInstallVariant(ua, prompt).variant).toBe(variant);
  });

  it('iOS 17: passos em <ol> com os botões do Safari em negrito; pular', () => {
    const onSkip = vi.fn();
    render(<InstallGuide platform="ios" variant="ios-17" onSkip={onSkip} />);
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[1]?.querySelector('strong')).toHaveTextContent('Adicionar à Tela de Início');
    expect(
      screen.getByText('Depois, abra o app pelo novo ícone na Tela de Início.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar no navegador por enquanto' }));
    expect(onSkip).toHaveBeenCalled();
  });

  it('terceiros: aviso e Copiar link; prompt: Instalar app; instalado', () => {
    const onCopy = vi.fn();
    const onInstall = vi.fn();
    const { rerender } = render(
      <InstallGuide platform="ios" variant="ios-thirdparty" onCopyLink={onCopy} />,
    );
    expect(screen.getByText('Para instalar, abra este link no Safari.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar link' }));
    expect(onCopy).toHaveBeenCalled();
    rerender(
      <InstallGuide
        platform="android"
        variant="android-prompt"
        onInstall={onInstall}
        onSkip={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Instalar app' }));
    expect(onInstall).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Agora não' })).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
    rerender(<InstallGuide platform="android" variant="android-chrome" state="installed" />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'App instalado. Abra pelo ícone na tela inicial.',
    );
  });
});
