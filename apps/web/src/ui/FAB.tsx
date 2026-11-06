import { Plus } from 'lucide-react';
import { useRef } from 'react';
import { uiText } from '../i18n/pt-BR';
import { type BaseProps, cx } from './types';

export interface FABProps extends BaseProps {
  onPress: () => void;
  onLongPress?: () => void;
  label?: string;
}

export const LONG_PRESS_MS = 500;

/** UX §5.3: 56 px; toque longo abre o menu (com alternativa no SegmentedControl do Q01). */
export function FAB({
  onPress,
  onLongPress,
  label = uiText.newEntry,
  className,
  'data-testid': testId,
}: FABProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const clear = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  return (
    <button
      type="button"
      className={cx('fab', className)}
      data-testid={testId}
      aria-label={label}
      aria-haspopup={onLongPress ? 'menu' : undefined}
      onPointerDown={() => {
        longPressed.current = false;
        if (onLongPress) {
          timer.current = setTimeout(() => {
            longPressed.current = true;
            onLongPress();
          }, LONG_PRESS_MS);
        }
      }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onClick={() => {
        if (longPressed.current) {
          longPressed.current = false;
          return;
        }
        onPress();
      }}
    >
      <Plus size={24} strokeWidth={2.5} aria-hidden="true" />
    </button>
  );
}
