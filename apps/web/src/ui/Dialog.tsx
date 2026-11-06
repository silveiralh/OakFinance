import { useRef } from 'react';
import { uiText } from '../i18n/pt-BR';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import type { BaseProps } from './types';

export interface DialogOption {
  value: string;
  label: string;
  tone?: 'default' | 'danger';
}

export interface DialogProps extends BaseProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  /** Escolhas no lugar do confirmar (ex.: parcelas: "Cancelar parcelas restantes" / "Apagar a compra inteira"). */
  options?: readonly DialogOption[];
  onConfirm?: () => void;
  onChoose?: (value: string) => void;
  onCancel: () => void;
}

/** UX §5.21: pergunta específica, consequência e verbo; destrutivo é `alertdialog` com foco no botão seguro. */
export function Dialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = uiText.cancel,
  tone = 'default',
  options,
  onConfirm,
  onChoose,
  onCancel,
  className,
  'data-testid': testId,
}: DialogProps) {
  const cancelRef = useRef<HTMLDivElement>(null);
  const destructive = tone === 'danger' || (options ?? []).some((o) => o.tone === 'danger');
  return (
    <BottomSheet
      open={open}
      onClose={onCancel}
      title={title}
      variant="dialog"
      role={destructive ? 'alertdialog' : 'dialog'}
      showClose={false}
      initialFocus={() => cancelRef.current?.querySelector('button') ?? null}
      {...(className ? { className } : {})}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      <p className="dialog-description">{description}</p>
      <div className="dialog-actions">
        {options?.map((o) => (
          <Button
            key={o.value}
            variant={o.tone === 'danger' ? 'danger' : 'secondary'}
            fullWidth
            onClick={() => onChoose?.(o.value)}
          >
            {o.label}
          </Button>
        ))}
        {!options && confirmLabel && (
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            fullWidth
            onClick={() => onConfirm?.()}
          >
            {confirmLabel}
          </Button>
        )}
        <div ref={cancelRef}>
          <Button variant="ghost" fullWidth onClick={onCancel}>
            {cancelLabel}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
