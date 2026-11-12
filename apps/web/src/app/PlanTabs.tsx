// Abas internas do Planejar (UXB-002, D-076; UX §2.1 e §5.9): Orçamento · Reserva · Futuro · Fechar o mês. O
// "Fechar o mês" abre o mês anterior, como o link da P01 (UX §3 P01, item 5).
import { todayIn } from '@oakfinance/domain';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { type MessageKey, t } from '../i18n/pt-BR';
import { SegmentedControl } from '../ui';
import { PLAN_TABS, type PlanTab, planTabPath } from './screens';

const LABEL: Readonly<Record<PlanTab, MessageKey>> = {
  P01: 'plan.tab.budget',
  P02: 'plan.tab.reserve',
  P03: 'plan.tab.future',
  P04: 'plan.tab.close',
};

export function PlanTabs({
  current,
  today = todayIn('America/Sao_Paulo', new Date()),
}: {
  current: PlanTab;
  today?: string;
}) {
  const navigate = useNavigate();
  const strip = useRef<HTMLDivElement>(null);
  // a faixa pode rolar a 360 px: a aba atual fica à vista
  useEffect(() => {
    const checked = strip.current?.querySelector<HTMLElement>('label[data-checked="true"]');
    checked?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, []);
  return (
    <div className="plan-tabs" data-testid="plan-tabs" ref={strip}>
      <SegmentedControl<PlanTab>
        label={t('plan.tabs')}
        value={current}
        options={PLAN_TABS.map((tab) => ({ value: tab, label: t(LABEL[tab]) }))}
        onChange={(tab) => void navigate(planTabPath(tab, today))}
      />
    </div>
  );
}
