import { Check, ChevronDown, CircleAlert, X } from 'lucide-react';
import { type ChangeEvent, type ReactNode, useId } from 'react';
import { uiText } from '../i18n/pt-BR';
import { type AppIcon, type BaseProps, cx } from './types';

interface FieldFrame {
  label: string;
  hint?: string;
  error?: string;
}

function Frame({
  id,
  frame,
  children,
  className,
  testId,
}: {
  id: string;
  frame: FieldFrame;
  children: ReactNode;
  className?: string | undefined;
  testId?: string | undefined;
}) {
  return (
    <div
      className={cx('field', className)}
      data-invalid={frame.error ? 'true' : undefined}
      data-testid={testId}
    >
      <label className="field-label" htmlFor={id}>
        {frame.label}
      </label>
      {children}
      {frame.hint && !frame.error && (
        <p id={`${id}-hint`} className="field-hint">
          {frame.hint}
        </p>
      )}
      {frame.error && (
        <p id={`${id}-error`} className="field-error">
          <CircleAlert size={16} aria-hidden="true" />
          {frame.error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, frame: FieldFrame): string | undefined {
  if (frame.error) {
    return `${id}-error`;
  }
  return frame.hint ? `${id}-hint` : undefined;
}

export interface TextFieldProps extends BaseProps, FieldFrame {
  value: string;
  onChange: (value: string) => void;
  prefixIcon?: AppIcon;
  clearable?: boolean;
  type?: 'text' | 'search' | 'email' | 'tel' | 'url';
  inputMode?: 'text' | 'decimal' | 'numeric' | 'search' | 'email' | 'tel' | 'url';
  placeholder?: string;
  autoComplete?: string;
}

/** UX §5.14: rótulo sempre visível acima, 52 px, fonte 16 px; erro com borda, ícone e texto. */
export function TextField({
  label,
  hint,
  error,
  value,
  onChange,
  prefixIcon: Prefix,
  clearable = false,
  type = 'text',
  inputMode,
  placeholder,
  autoComplete,
  className,
  'data-testid': testId,
}: TextFieldProps) {
  const id = useId();
  const frame = { label, ...(hint ? { hint } : {}), ...(error ? { error } : {}) };
  return (
    <Frame id={id} frame={frame} className={className} testId={testId}>
      <div className="field-box">
        {Prefix && (
          <span className="field-prefix">
            <Prefix size={20} aria-hidden="true" />
          </span>
        )}
        <input
          id={id}
          type={type}
          value={value}
          inputMode={inputMode}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, frame)}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        />
        {clearable && value !== '' && (
          <button
            type="button"
            className="icon-btn"
            aria-label={uiText.clear}
            onClick={() => onChange('')}
          >
            <X size={20} aria-hidden="true" />
          </button>
        )}
      </div>
    </Frame>
  );
}

export interface SelectProps extends BaseProps, FieldFrame {
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}

/** UX §5.14: `<select>` nativo com o visual do TextField. */
export function Select({
  label,
  hint,
  error,
  value,
  onChange,
  options,
  className,
  'data-testid': testId,
}: SelectProps) {
  const id = useId();
  const frame = { label, ...(hint ? { hint } : {}), ...(error ? { error } : {}) };
  return (
    <Frame id={id} frame={frame} className={className} testId={testId}>
      <div className="field-box">
        <select
          id={id}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, frame)}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {/* UXB-007: sem a seta, a lista parecia um campo de texto */}
        <ChevronDown className="field-chevron" size={20} strokeWidth={2} aria-hidden="true" />
      </div>
    </Frame>
  );
}

export interface SwitchProps extends BaseProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
}

/** UX §5.14: `role="switch"` 52×32 numa linha de 48 px; ligado também mostra o ícone Check. */
export function Switch({
  label,
  checked,
  onChange,
  description,
  className,
  'data-testid': testId,
}: SwitchProps) {
  const id = useId();
  return (
    <div className={cx('switch-row', className)} data-testid={testId}>
      <span>
        <span id={`${id}-label`}>{label}</span>
        {description && (
          <span id={`${id}-desc`} className="field-hint" style={{ display: 'block' }}>
            {description}
          </span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-thumb">
          {checked && <Check size={14} strokeWidth={2.5} aria-hidden="true" />}
        </span>
      </button>
    </div>
  );
}
