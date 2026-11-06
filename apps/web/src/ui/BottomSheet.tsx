import { X } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useId, useRef } from 'react';
import { uiText } from '../i18n/pt-BR';
import { type BaseProps, cx } from './types';

export interface BottomSheetProps extends BaseProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Título só para leitor de tela (o `aria-labelledby` continua). */
  hideTitle?: boolean;
  children: ReactNode;
  snapPoints?: number[];
  dismissible?: boolean;
  confirmClose?: () => boolean | Promise<boolean>;
  variant?: 'sheet' | 'dialog';
  /** `alertdialog` para confirmações destrutivas (Dialog). */
  role?: 'dialog' | 'alertdialog';
  /** Elemento que recebe o foco ao abrir (padrão: o primeiro focável). */
  initialFocus?: () => HTMLElement | null;
  showClose?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function autoVariant(): 'sheet' | 'dialog' {
  try {
    return window.matchMedia?.('(min-width: 1024px)').matches ? 'dialog' : 'sheet';
  } catch {
    return 'sheet';
  }
}

/**
 * UX §5.20: `<dialog>` nativo com `showModal()`; foco preso, Esc fecha (respeitando `confirmClose`), foco volta ao
 * gatilho, rolagem do fundo travada e botão Fechar visível.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  hideTitle = false,
  children,
  snapPoints = [0.88],
  dismissible = true,
  confirmClose,
  variant,
  role = 'dialog',
  initialFocus,
  showClose = true,
  className,
  'data-testid': testId,
}: BottomSheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const trigger = useRef<HTMLElement | null>(null);
  const focusTarget = useRef(initialFocus);
  focusTarget.current = initialFocus;

  const requestClose = useCallback(async () => {
    if (!dismissible) {
      return;
    }
    if (confirmClose && !(await confirmClose())) {
      return;
    }
    onClose();
  }, [confirmClose, dismissible, onClose]);

  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) {
      return;
    }
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof dialog.showModal === 'function' && !dialog.open) {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const first =
      focusTarget.current?.() ??
      dialog.querySelector('.sheet-body')?.querySelector<HTMLElement>(FOCUSABLE) ??
      dialog.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (typeof dialog.close === 'function' && dialog.open) {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
      trigger.current?.focus();
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      void requestClose();
      return;
    }
    if (event.key !== 'Tab' || !ref.current) {
      return;
    }
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const firstItem = items[0];
    const lastItem = items.at(-1);
    if (!firstItem || !lastItem) {
      return;
    }
    if (event.shiftKey && document.activeElement === firstItem) {
      event.preventDefault();
      lastItem.focus();
    } else if (!event.shiftKey && document.activeElement === lastItem) {
      event.preventDefault();
      firstItem.focus();
    }
  };

  if (!open) {
    return null;
  }
  const height = `${Math.round((snapPoints[0] ?? 0.88) * 100)}dvh`;
  return (
    <dialog
      ref={ref}
      className={cx('glass sheet', className)}
      data-level="3"
      data-variant={variant ?? autoVariant()}
      data-testid={testId}
      role={role === 'alertdialog' ? 'alertdialog' : undefined}
      aria-modal="true"
      aria-labelledby={titleId}
      style={{ maxHeight: height }}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        void requestClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          void requestClose();
        }
      }}
    >
      <div className="sheet-handle" aria-hidden="true" />
      <div className="sheet-head">
        <h2 id={titleId} className={hideTitle ? 'sr-only' : 'sheet-title'}>
          {title}
        </h2>
        {showClose && dismissible && (
          <button
            type="button"
            className="icon-btn"
            aria-label={uiText.close}
            onClick={() => void requestClose()}
          >
            <X size={24} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="sheet-body">{children}</div>
    </dialog>
  );
}
