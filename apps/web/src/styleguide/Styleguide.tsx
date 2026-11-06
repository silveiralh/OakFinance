// Rota /__styleguide: só existe no build E2E (VITE_E2E=1). Base do snapshot visual dos tokens (T-028).
import { Bell, House, List, PiggyBank, ShoppingCart, Tag } from 'lucide-react';
import {
  AppBackdrop,
  BrandLogo,
  BudgetRing,
  Button,
  FAB,
  GlassCard,
  GoalProgress,
  InstallGuide,
  InvoiceCard,
  MoneyText,
  PaceIndicator,
  ProgressBar,
  SyncBadge,
  TabBar,
  TopBar,
  TransactionRow,
} from '../ui';

const SWATCHES = [
  'text-primary',
  'text-secondary',
  'text-link',
  'money-income',
  'status-warning-fill',
  'status-danger-fill',
  'band-needs',
  'band-wants',
  'band-savings',
  'border-strong',
];

export function Styleguide() {
  return (
    <>
      <AppBackdrop />
      <main
        style={{
          position: 'relative',
          padding: 'var(--space-4)',
          display: 'grid',
          gap: 'var(--space-6)',
          paddingBottom: 120,
        }}
      >
        <TopBar title="Styleguide" trailing={<SyncBadge state="pending" pendingCount={3} />} />
        <section
          data-testid="tokens"
          className="glass"
          style={{ padding: 'var(--space-5)', display: 'grid', gap: 'var(--space-3)' }}
        >
          <BrandLogo height={40} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            {SWATCHES.map((name) => (
              <span
                key={name}
                title={name}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 'var(--radius-sm)',
                  background: `var(--${name})`,
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            <Button>Lançar</Button>
            <Button variant="secondary">Ver tudo</Button>
            <Button variant="danger">Excluir</Button>
          </div>
          <MoneyText value={123456} kind="expense" size="display" />
          <PaceIndicator state="on_track" />
          <PaceIndicator state="attention" amountCents={30000} />
          <PaceIndicator state="over" amountCents={4500} />
          <PaceIndicator state="no_income" />
          <ProgressBar label="Necessidades" valueCents={53} maxCents={100} tone="band-needs" />
        </section>
        <GlassCard title="Orçamento">
          <BudgetRing
            incomeCents={480000}
            bands={[
              { key: 'needs', spentCents: 127200, plannedCents: 240000 },
              { key: 'wants', spentCents: 150000, plannedCents: 144000 },
              { key: 'savings', spentCents: 24000, plannedCents: 96000 },
            ]}
          />
        </GlassCard>
        <GlassCard title="Reserva">
          <GoalProgress savedCents={720000} goalCents={1440000} />
          <GoalProgress savedCents={0} goalCents={null} variant="bar" />
        </GlassCard>
        <InvoiceCard
          card={{ name: 'Nubank', brandColor: 'violet' }}
          invoice={{
            month: '2026-12',
            totalCents: 98000,
            remainingCents: 98000,
            closesOn: '2026-12-03',
            dueOn: '2026-12-10',
            status: 'closed',
          }}
          daysToDue={2}
          limitCents={500000}
          usedCents={98000}
        />
        <GlassCard title="Lançamentos" padding="none">
          <TransactionRow
            tx={{
              id: '1',
              kind: 'expense',
              amountCents: 3290,
              description: 'Padaria',
              category: { name: 'Mercado', icon: ShoppingCart, band: 'needs' },
              method: 'Nubank crédito',
              when: 'hoje 14:32',
              installment: { n: 3, total: 10 },
              syncState: 'pending',
              state: 'forecast',
            }}
          />
        </GlassCard>
        <InstallGuide platform="ios" variant="ios-17" />
      </main>
      <TabBar
        activeKey="home"
        center={<FAB onPress={() => {}} />}
        items={[
          { key: 'home', label: 'Início', icon: House, href: '/' },
          { key: 'list', label: 'Lançamentos', icon: List, href: '/lancamentos' },
          { key: 'plan', label: 'Planejar', icon: Tag, href: '/planejar' },
          { key: 'notices', label: 'Avisos', icon: Bell, href: '/avisos', badge: 2 },
          { key: 'reserve', label: 'Reserva', icon: PiggyBank, href: '/planejar/reserva' },
        ]}
      />
    </>
  );
}
