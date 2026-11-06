import { CheckCircle, Info, Warning } from '@phosphor-icons/react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from './Button';

export interface ToastInput {
  message: string;
  tone?: 'info' | 'success' | 'warning';
  action?: { label: string; onPress: () => void };
  /** ms; padrão 4.000, ou 8.000 com ação; `Infinity` não some sozinho (G07). */
  duration?: number;
}

export const TOAST_MS = 4000;
export const TOAST_WITH_ACTION_MS = 8000;

const ICON = { info: Info, success: CheckCircle, warning: Warning } as const;

interface Queued extends ToastInput {
  id: number;
}

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

/** Mostra um toast (fila de 1 por vez, UX §5.22). */
export function useToast(): (toast: ToastInput) => void {
  const push = useContext(ToastContext);
  if (!push) {
    throw new Error('useToast fora do ToastProvider');
  }
  return push;
}

/** Região `aria-live="polite"` acima da TabBar; pausa com foco ou ponteiro sobre o toast. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Queued[]>([]);
  const [paused, setPaused] = useState(false);
  const seq = useRef(0);
  const push = useCallback((toast: ToastInput) => {
    seq.current += 1;
    const id = seq.current;
    setQueue((q) => [...q, { ...toast, id }]);
  }, []);
  const current = queue[0];
  const dismiss = useCallback(() => setQueue((q) => q.slice(1)), []);
  const duration = current
    ? (current.duration ?? (current.action ? TOAST_WITH_ACTION_MS : TOAST_MS))
    : 0;

  useEffect(() => {
    if (!current || paused || !Number.isFinite(duration)) {
      return;
    }
    const timer = setTimeout(dismiss, duration);
    return () => clearTimeout(timer);
  }, [current, paused, duration, dismiss]);

  const value = useMemo(() => push, [push]);
  const tone = current?.tone ?? 'success';
  const Glyph = ICON[tone];
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="toast-region"
        role="status"
        aria-live="polite"
        data-testid="toast-region"
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        {current && (
          <div key={current.id} className="glass toast" data-level="3" data-tone={tone}>
            <Glyph size={20} aria-hidden="true" />
            <p>{current.message}</p>
            {current.action && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  current.action?.onPress();
                  setPaused(false);
                  dismiss();
                }}
              >
                {current.action.label}
              </Button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
