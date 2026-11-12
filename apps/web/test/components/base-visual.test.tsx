// T-117: componentes tocados pela base visual (UXB-019 arco de 0%, UXA-005 classe do anel, UXB-007 seta do select,
// UXA-024 selo "Conferir").
import { render, screen } from '@testing-library/react';
import { ShoppingCart } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { BudgetRing, GoalProgress, Select, TransactionRow } from '../../src/ui';

describe('T-117: componentes da base visual', () => {
  it('UXB-019: faixa com 0% gasto desenha só o trilho, sem o ponto da ponta redonda', () => {
    const { container } = render(
      <BudgetRing
        incomeCents={480000}
        bands={[
          { key: 'needs', spentCents: 120000, plannedCents: 240000 },
          { key: 'wants', spentCents: 0, plannedCents: 144000 },
          { key: 'savings', spentCents: 0, plannedCents: 96000 },
        ]}
      />,
    );
    expect(container.querySelectorAll('[data-band="needs"] .budget-ring-arc')).toHaveLength(1);
    expect(container.querySelectorAll('[data-band="wants"] .budget-ring-arc')).toHaveLength(0);
    expect(container.querySelectorAll('[data-band="savings"] .budget-ring-arc')).toHaveLength(0);
  });

  it('UXA-005/UXB-014: o anel usa a classe budget-ring, não o utilitário ring do Tailwind', () => {
    const { container } = render(
      <BudgetRing incomeCents={0} bands={[{ key: 'needs', spentCents: 0, plannedCents: 0 }]} />,
    );
    const figure = container.querySelector('figure');
    expect(figure?.classList.contains('budget-ring')).toBe(true);
    expect(figure?.classList.contains('ring')).toBe(false);
  });

  it('UXB-019: reserva sem nada guardado não desenha o arco', () => {
    const { container, rerender } = render(<GoalProgress savedCents={0} goalCents={1440000} />);
    expect(container.querySelector('.budget-ring-arc')).toBeNull();
    rerender(<GoalProgress savedCents={720000} goalCents={1440000} />);
    expect(container.querySelector('.budget-ring-arc')).not.toBeNull();
  });

  it('UXB-007: o select mostra a seta, escondida do leitor de tela', () => {
    const { container } = render(
      <Select
        label="Conta"
        value="bb"
        onChange={() => {}}
        options={[
          { value: 'bb', label: 'Banco do Brasil' },
          { value: 'nu', label: 'Nubank' },
        ]}
      />,
    );
    const chevron = container.querySelector('.field-chevron');
    expect(chevron).not.toBeNull();
    expect(chevron?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByLabelText('Conta')).toHaveValue('bb');
  });

  it('UXA-024: "Conferir" sai com forma de selo (data-seal="review")', () => {
    const { container } = render(
      <TransactionRow
        tx={{
          id: '1',
          kind: 'expense',
          amountCents: 2790,
          description: 'PADARIA EXEMPLO',
          category: { name: 'Mercado', icon: ShoppingCart, band: 'needs' },
          method: 'Débito',
          when: '11/11/2026',
          syncState: 'synced',
          needsReview: true,
        }}
      />,
    );
    const seal = container.querySelector('.tx-seal[data-seal="review"]');
    expect(seal?.textContent).toBe('Conferir');
  });
});
