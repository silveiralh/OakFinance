import { Backspace } from '@phosphor-icons/react';
import { useRef } from 'react';
import { uiText } from '../i18n/pt-BR';
import { type BaseProps, cx } from './types';

export interface NumericKeypadProps extends BaseProps {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  extraKey?: '00' | ',';
}

export const CLEAR_HOLD_MS = 500;
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** UX §5.8: teclas ≥ 64×56 px em vidro 3; toque longo em Apagar limpa tudo. */
export function NumericKeypad({
  onDigit,
  onBackspace,
  onClear,
  extraKey = '00',
  className,
  'data-testid': testId,
}: NumericKeypadProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const stop = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const key = (label: string) => (
    <button
      key={label}
      type="button"
      className="key glass"
      data-level="3"
      onClick={() => onDigit(label)}
    >
      {label}
    </button>
  );
  return (
    <fieldset className={cx('keypad', className)} data-testid={testId}>
      <legend className="sr-only">{uiText.keypad}</legend>
      {DIGITS.map(key)}
      {key(extraKey)}
      {key('0')}
      <button
        type="button"
        className="key glass"
        data-level="3"
        aria-label={uiText.backspace}
        onPointerDown={() => {
          held.current = false;
          timer.current = setTimeout(() => {
            held.current = true;
            onClear();
          }, CLEAR_HOLD_MS);
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onClick={() => {
          if (held.current) {
            held.current = false;
            return;
          }
          onBackspace();
        }}
      >
        <Backspace size={24} aria-hidden="true" />
      </button>
    </fieldset>
  );
}
