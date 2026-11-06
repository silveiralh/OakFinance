import { act, fireEvent, render, screen } from '@testing-library/react';
import { Pill, ShoppingCart, Ticket, Utensils } from 'lucide-react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AmountInput,
  appendDigits,
  CategoryChip,
  CategoryPicker,
  type ChipCategory,
  DateChip,
  InstallmentStepper,
  installmentPreview,
  type PaymentMethodOption,
  PaymentMethodPicker,
  parsePastedAmount,
} from '../../src/ui';
import { CLEAR_HOLD_MS } from '../../src/ui/NumericKeypad';

const MAX = 99_999_999;

function Amount(props: {
  initial?: number;
  keypad?: 'custom' | 'native';
  error?: string;
  disabled?: boolean;
}) {
  const [v, setV] = useState(props.initial ?? 0);
  return (
    <AmountInput
      value={v}
      onChange={setV}
      keypad={props.keypad ?? 'custom'}
      data-testid="valor"
      {...(props.error ? { error: props.error } : {})}
      {...(props.disabled ? { disabled: true } : {})}
    />
  );
}

const live = () => screen.getByTestId('valor-live');

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AmountInput e NumericKeypad (UX §5.8, RN-01, US-12)', () => {
  it('US-12: digitar "4590" mostra "R$ 45,90" e anuncia o valor', () => {
    render(<Amount />);
    const input = screen.getByLabelText('Valor');
    expect(input).toHaveValue('R$ 0,00');
    expect(input).toHaveAttribute('data-empty', 'true');
    for (const key of '4590') {
      fireEvent.keyDown(input, { key });
    }
    expect(input).toHaveValue('R$ 45,90');
    expect(input).toHaveAttribute('data-empty', 'false');
    expect(live()).toHaveAttribute('aria-live', 'polite');
    expect(live()).toHaveTextContent('Valor: R$ 45,90');
  });

  it('teclado do app: dígitos, 00, apagar e toque longo para limpar', () => {
    vi.useFakeTimers();
    render(<Amount />);
    const pad = screen.getByRole('group', { name: 'Teclado numérico' });
    expect(pad).toBeInTheDocument();
    for (const d of ['1', '2']) {
      fireEvent.click(screen.getByRole('button', { name: d }));
    }
    fireEvent.click(screen.getByRole('button', { name: '00' }));
    expect(screen.getByLabelText('Valor')).toHaveValue('R$ 12,00');
    const back = screen.getByRole('button', { name: 'Apagar' });
    fireEvent.click(back);
    expect(screen.getByLabelText('Valor')).toHaveValue('R$ 1,20');
    fireEvent.pointerDown(back);
    act(() => {
      vi.advanceTimersByTime(CLEAR_HOLD_MS);
    });
    fireEvent.pointerUp(back);
    fireEvent.click(back);
    expect(screen.getByLabelText('Valor')).toHaveValue('R$ 0,00');
    fireEvent.click(screen.getByRole('button', { name: '7' }));
    fireEvent.pointerDown(back);
    fireEvent.pointerLeave(back);
    fireEvent.click(back);
    expect(screen.getByLabelText('Valor')).toHaveValue('R$ 0,00');
  });

  it('RN-01: não passa de R$ 999.999,99', () => {
    render(<Amount initial={MAX} />);
    const input = screen.getByLabelText('Valor');
    fireEvent.keyDown(input, { key: '1' });
    expect(input).toHaveValue('R$ 999.999,99');
    expect(appendDigits(9_999_999, '99', MAX)).toBe(99_999_999);
    expect(appendDigits(99_999_999, '0', MAX)).toBe(99_999_999);
  });

  it('teclado físico: Backspace volta um dígito; Delete e Esc zeram; outras teclas não mexem', () => {
    render(<Amount initial={4590} />);
    const input = screen.getByLabelText('Valor');
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(input).toHaveValue('R$ 4,59');
    fireEvent.keyDown(input, { key: 'a' });
    expect(input).toHaveValue('R$ 4,59');
    fireEvent.keyDown(input, { key: 'Delete' });
    expect(input).toHaveValue('R$ 0,00');
    fireEvent.keyDown(input, { key: '3' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('R$ 0,00');
  });

  it.each([
    ['R$ 1.234,56', 123_456],
    ['32,90', 3290],
    ['32.9', 3290],
    ['1.234', 123_400],
    ['abc', null],
    ['-5,00', null],
    ['1.000.000,00', null],
  ] as const)('colar "%s" → %s', (text, cents) => {
    expect(parsePastedAmount(text, MAX)).toBe(cents);
  });

  it('colar interpreta o texto; colagem inválida é ignorada', () => {
    render(<Amount />);
    const input = screen.getByLabelText('Valor');
    fireEvent.paste(input, { clipboardData: { getData: () => 'R$ 1.234,56' } });
    expect(input).toHaveValue('R$ 1.234,56');
    fireEvent.paste(input, { clipboardData: { getData: () => 'banana' } });
    expect(input).toHaveValue('R$ 1.234,56');
  });

  it('teclado nativo (lg): inputmode decimal e reinterpretação dos dígitos', () => {
    render(<Amount keypad="native" />);
    const input = screen.getByLabelText('Valor');
    expect(input).toHaveAttribute('inputmode', 'decimal');
    expect(screen.queryByRole('group', { name: 'Teclado numérico' })).toBeNull();
    fireEvent.change(input, { target: { value: 'R$ 0,0123' } });
    expect(input).toHaveValue('R$ 1,23');
  });

  it('erro com aria-invalid; desativado não muda nem mostra o teclado', () => {
    const { unmount } = render(<Amount error="Informe um valor maior que zero." />);
    const input = screen.getByLabelText('Valor');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Informe um valor maior que zero.');
    unmount();
    render(<Amount disabled initial={100} />);
    fireEvent.keyDown(screen.getByLabelText('Valor'), { key: '5' });
    expect(screen.getByLabelText('Valor')).toHaveValue('R$ 1,00');
    expect(screen.queryByRole('group', { name: 'Teclado numérico' })).toBeNull();
  });

  it('sem `keypad`, usa o teclado do app no toque e o nativo com mouse', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { unmount } = render(<AmountInput value={0} onChange={() => {}} />);
    expect(screen.getByRole('group', { name: 'Teclado numérico' })).toBeInTheDocument();
    unmount();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    render(<AmountInput value={0} onChange={() => {}} />);
    expect(screen.queryByRole('group', { name: 'Teclado numérico' })).toBeNull();
  });
});

const CATS: ChipCategory[] = [
  { id: 'mercado', name: 'Mercado', icon: ShoppingCart, band: 'needs' },
  { id: 'farmacia', name: 'Farmácia', icon: Pill, band: 'needs' },
  { id: 'restaurantes', name: 'Restaurantes e delivery', icon: Utensils, band: 'wants' },
  { id: 'lazer', name: 'Lazer', icon: Ticket, band: 'wants' },
  { id: 'salario', name: 'Salário', icon: Ticket, band: 'income' },
];

describe('CategoryChip e CategoryPicker (UX §5.10)', () => {
  it('rádio nativo; sugerida é lida; selecionado tem check e não depende só de cor', () => {
    const onPress = vi.fn();
    const { rerender } = render(
      <CategoryChip
        category={CATS[0] as ChipCategory}
        name="cat"
        selected={false}
        suggested
        onPress={onPress}
      />,
    );
    const radio = screen.getByRole('radio', { name: /Mercado.*sugerida/ });
    expect(radio).not.toBeChecked();
    fireEvent.click(radio);
    expect(onPress).toHaveBeenCalled();
    rerender(
      <CategoryChip category={CATS[0] as ChipCategory} name="cat" selected onPress={onPress} />,
    );
    expect(screen.getByRole('radio', { name: 'Mercado' })).toBeChecked();
    const label = screen.getByRole('radio').closest('label');
    expect(label).toHaveAttribute('data-band', 'needs');
    expect(label?.querySelectorAll('svg')).toHaveLength(2);
  });

  it('sheet com busca sem acento, recentes, grupos por faixa e "Criar categoria"', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    const onCreate = vi.fn();
    render(
      <CategoryPicker
        open
        onClose={onClose}
        categories={CATS}
        recentIds={['lazer', 'nao-existe']}
        value="mercado"
        onChange={onChange}
        onCreate={onCreate}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Categoria' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Recentes' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Necessidades' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Desejos' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Poupança' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'farmacia' } });
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.queryByRole('group', { name: 'Recentes' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Farmácia' }));
    expect(onChange).toHaveBeenCalledWith('farmacia');
    expect(onClose).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: '' } });
    expect(screen.getByRole('radio', { name: 'Salário' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Criar categoria' }));
    expect(onCreate).toHaveBeenCalled();
  });
});

const METHODS: PaymentMethodOption[] = [
  { id: 'pix-bb', kind: 'pix', label: 'Pix BB', accountId: 'bb' },
  { id: 'deb-bb', kind: 'debit', label: 'Débito BB', accountId: 'bb' },
  {
    id: 'cred-nu',
    kind: 'credit',
    label: 'Nubank · crédito',
    accountId: null,
    cardId: 'nu',
    detail: 'fatura fecha dia 3',
  },
];

describe('PaymentMethodPicker (UX §5.11)', () => {
  it('compacto abre a lista em sheet; escolher fecha e informa', () => {
    const onChange = vi.fn();
    render(<PaymentMethodPicker methods={METHODS} value="pix-bb" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Meio de pagamento: Pix BB' }));
    const dialog = screen.getByRole('dialog', { name: 'Meio de pagamento' });
    expect(dialog).toHaveTextContent('fatura fecha dia 3');
    fireEvent.click(screen.getByRole('radio', { name: /Nubank · crédito/ }));
    expect(onChange).toHaveBeenCalledWith('cred-nu');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lista direta e dica da fatura só no crédito', () => {
    const { rerender } = render(
      <PaymentMethodPicker
        variant="list"
        methods={METHODS}
        value="cred-nu"
        onChange={() => {}}
        invoiceHint="Entra na fatura de dezembro (fecha 03/12)"
      />,
    );
    expect(screen.getByRole('radio', { name: /Nubank · crédito/ })).toBeChecked();
    expect(screen.getByText('Entra na fatura de dezembro (fecha 03/12)')).toBeInTheDocument();
    rerender(
      <PaymentMethodPicker
        variant="list"
        methods={METHODS}
        value="deb-bb"
        onChange={() => {}}
        invoiceHint="x"
      />,
    );
    expect(screen.queryByText('x')).toBeNull();
    rerender(<PaymentMethodPicker methods={METHODS} value="nenhum" onChange={() => {}} />);
    expect(
      screen.getByRole('button', { name: 'Meio de pagamento: Meio de pagamento' }),
    ).toBeInTheDocument();
  });
});

function Stepper({ amount = 100_000, initial = 1 }: { amount?: number; initial?: number }) {
  const [n, setN] = useState(initial);
  const [mode, setMode] = useState<'total' | 'installment'>('total');
  return (
    <InstallmentStepper
      value={n}
      onChange={setN}
      amountCents={amount}
      mode={mode}
      onModeChange={setMode}
      firstInvoiceLabel="dezembro"
    />
  );
}

describe('InstallmentStepper (UX §5.12, RN-20, US-20)', () => {
  it('US-12/US-20: "À vista | 2x … 12x" e "Mais" até 48x', () => {
    render(<Stepper />);
    expect(screen.getByRole('radio', { name: 'À vista' })).toBeChecked();
    expect(screen.getAllByRole('radio', { name: /^\d+x$/ })).toHaveLength(11);
    fireEvent.click(screen.getByRole('button', { name: 'Mais' }));
    expect(screen.getByRole('radio', { name: '48x' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: '49x' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mais' })).toBeNull();
  });

  it('RN-20/RN-21: "10x de R$ 100,00 · primeira parcela em dezembro"; parcela informada', () => {
    render(<Stepper />);
    fireEvent.click(screen.getByRole('radio', { name: '10x' }));
    expect(screen.getByText('10x de R$ 100,00 · primeira parcela em dezembro')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Parcela' }));
    expect(
      screen.getByText('10x de R$ 1.000,00 · primeira parcela em dezembro'),
    ).toBeInTheDocument();
    expect(installmentPreview(10_000, 3, 'total')).toBe(3333);
    expect(installmentPreview(4990, 10, 'installment')).toBe(4990);
  });

  it('RN-20: total mínimo = n centavos (opções acima ficam indisponíveis)', () => {
    render(<Stepper amount={5} initial={13} />);
    expect(screen.getByRole('radio', { name: '5x' })).not.toBeDisabled();
    expect(screen.getByRole('radio', { name: '6x' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: '48x' })).toBeDisabled();
  });
});

describe('DateChip (UX §5.13)', () => {
  it('Hoje, Ontem e o campo nativo em "Escolher"', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DateChip value="2026-11-06" today="2026-11-06" onChange={onChange} />,
    );
    expect(screen.getByRole('button', { name: 'Hoje' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Ontem' }));
    expect(onChange).toHaveBeenCalledWith('2026-11-05');
    fireEvent.click(screen.getByRole('button', { name: 'Hoje' }));
    expect(onChange).toHaveBeenCalledWith('2026-11-06');
    const native = screen.getByLabelText('Escolher');
    expect(native).toHaveAttribute('type', 'date');
    fireEvent.change(native, { target: { value: '2026-10-31' } });
    expect(onChange).toHaveBeenLastCalledWith('2026-10-31');
    fireEvent.change(native, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledTimes(3);
    rerender(<DateChip value="2026-11-05" today="2026-11-06" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Ontem' })).toHaveAttribute('aria-pressed', 'true');
  });
});
