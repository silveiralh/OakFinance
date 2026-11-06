import { CloudCheck, CloudOff, CloudUpload, RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { uiText } from '../i18n/pt-BR';
import { type BaseProps, cx } from './types';

export type SyncState = 'synced' | 'pending' | 'syncing' | 'offline' | 'error';

export interface SyncBadgeProps extends BaseProps {
  state: SyncState;
  pendingCount?: number;
  onPress?: () => void;
}

export const SYNCED_HIDE_MS = 2000;

/** Rótulo do botão: "Offline, 3 lançamentos salvos neste aparelho". */
export function syncLabel(state: SyncState, pendingCount: number): string {
  const pending = uiText.syncPending.replace('{n}', String(pendingCount));
  switch (state) {
    case 'synced':
      return uiText.syncSynced;
    case 'syncing':
      return uiText.syncSyncing;
    case 'offline':
      return pendingCount > 0 ? `${uiText.syncOffline}, ${pending}` : uiText.syncOffline;
    case 'error':
      return pendingCount > 0 ? `${uiText.syncError}, ${pending}` : uiText.syncError;
    default:
      return pending;
  }
}

const ICON = {
  synced: CloudCheck,
  pending: CloudUpload,
  syncing: RefreshCw,
  offline: CloudOff,
  error: TriangleAlert,
} as const;

/** UX §5.24: pílula no topo; `synced` some depois de 2 s; região viva só para offline, erro e a volta após erro. */
export function SyncBadge({
  state,
  pendingCount = 0,
  onPress,
  className,
  'data-testid': testId,
}: SyncBadgeProps) {
  const [visible, setVisible] = useState(true);
  const [announce, setAnnounce] = useState('');
  const [previous, setPrevious] = useState<SyncState>(state);
  if (previous !== state) {
    setPrevious(state);
    setVisible(true);
    setAnnounce(
      state === 'offline' || state === 'error' || (state === 'synced' && previous === 'error')
        ? syncLabel(state, pendingCount)
        : '',
    );
  }
  useEffect(() => {
    if (state !== 'synced') {
      return;
    }
    const timer = setTimeout(() => setVisible(false), SYNCED_HIDE_MS);
    return () => clearTimeout(timer);
  }, [state]);
  const Glyph = ICON[state];
  return (
    <span className={cx(className)} data-testid={testId}>
      {visible && (
        <button
          type="button"
          className="sync-badge glass"
          data-level="1"
          data-state={state}
          aria-label={syncLabel(state, pendingCount)}
          onClick={onPress}
        >
          <Glyph size={20} aria-hidden="true" data-spin={state === 'syncing'} />
          {(state === 'pending' || state === 'offline') && pendingCount > 0 && (
            <span aria-hidden="true">{pendingCount}</span>
          )}
          {state === 'offline' && <span aria-hidden="true">{uiText.syncOffline}</span>}
          {state === 'error' && <span aria-hidden="true">{uiText.syncError}</span>}
        </button>
      )}
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </span>
  );
}
