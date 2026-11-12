import { formatBRL, MAX_TX_CENTS, parseBRL, parseSignedCents } from '@oakfinance/domain';
import { CircleAlert } from 'lucide-react';
import { type ClipboardEvent, type KeyboardEvent, type Ref, useId } from 'react';
import { uiText } from '../i18n/pt-BR';
import { NumericKeypad } from './NumericKeypad';
import { type BaseProps, cx } from './types';

export interface AmountInputProps extends BaseProps {
  value: number;
  onChange: (cents: number) => void;
  size?: 'display' | 'compact';
  max?: number;
  label?: string;
  error?: string;
  autoFocus?: boolean;
  keypad?: 'custom' | 'native';
  /** `false`: o teclado próprio fica a cargo de quem usa (o Q01 o põe no rodapé fixo, UXA-003). */
  showKeypad?: boolean;
  /** Ref do `<input>` (o Q01 abre com o foco nele, UXA-008). */
  inputRef?: Ref<HTMLInputElement>;
  disabled?: boolean;
}

/** Caixa eletrônico: cada dígito entra pela direita ("4590" → R$ 45,90). Acima do máximo, ignora. */
export function appendDigits(cents: number, digits: string, max: number): number {
  let next = cents;
  for (const d of digits) {
    const candidate = next * 10 + Number(d);
    if (candidate > max) {
      return next;
    }
    next = candidate;
  }
  return next;
}

/** Texto colado: "32,90", "R$ 1.234,56", "32.9", "1.234" → centavos; `null` se inválido, negativo ou acima do máximo. */
export function parsePastedAmount(text: string, max: number): number | null {
  const clean = text.trim();
  let cents: number | null;
  try {
    cents = parseBRL(clean);
  } catch {
    cents = parseSignedCents(clean, 'auto');
  }
  return cents === null || cents < 0 || cents > max ? null : cents;
}

export function preferredKeypad(): 'custom' | 'native' {
  try {
    return window.matchMedia?.('(pointer: coarse)').matches ? 'custom' : 'native';
  } catch {
    return 'native';
  }
}

/** UX §5.8 e RN-01: valor em centavos, máximo R$ 999.999,99, anúncio do valor em região viva. */
export function AmountInput({
  value,
  onChange,
  size = 'display',
  max = MAX_TX_CENTS,
  label = uiText.amount,
  error,
  autoFocus = false,
  keypad,
  showKeypad = true,
  inputRef,
  disabled = false,
  className,
  'data-testid': testId,
}: AmountInputProps) {
  const id = useId();
  const mode = keypad ?? preferredKeypad();
  const formatted = formatBRL(value);
  const set = (cents: number) => {
    if (!disabled && cents !== value) {
      onChange(cents);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      set(appendDigits(value, event.key, max));
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      set(Math.floor(value / 10));
    } else if (event.key === 'Delete' || event.key === 'Escape') {
      event.preventDefault();
      set(0);
    }
  };
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const cents = parsePastedAmount(event.clipboardData.getData('text'), max);
    if (cents !== null) {
      set(cents);
    }
  };
  return (
    <div className={cx('amount', className)} data-size={size} data-testid={testId}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        className="amount-input"
        type="text"
        inputMode={mode === 'custom' ? 'none' : 'decimal'}
        autoComplete="off"
        // biome-ignore lint/a11y/noAutofocus: o Q01 abre com o valor focado (US-12)
        autoFocus={autoFocus}
        disabled={disabled}
        value={formatted}
        data-empty={value === 0}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onChange={(event) => {
          // teclado nativo: reinterpreta todos os dígitos digitados (mesmo modelo de caixa eletrônico)
          set(appendDigits(0, event.target.value.replace(/\D/g, '').replace(/^0+/, ''), max));
        }}
      />
      <span
        className="sr-only"
        aria-live="polite"
        data-testid={testId ? `${testId}-live` : undefined}
      >
        {`${label}: ${formatted}`}
      </span>
      {error && (
        <p id={`${id}-error`} className="field-error">
          <CircleAlert size={16} aria-hidden="true" />
          {error}
        </p>
      )}
      {mode === 'custom' && showKeypad && !disabled && (
        <NumericKeypad
          onDigit={(d) => set(appendDigits(value, d, max))}
          onBackspace={() => set(Math.floor(value / 10))}
          onClear={() => set(0)}
        />
      )}
    </div>
  );
}
