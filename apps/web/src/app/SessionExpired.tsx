import { useState, useSyncExternalStore } from 'react';
import type { SyncEngine } from '../data/sync/engine';
import { shellText } from '../i18n/pt-BR';
import { Dialog } from '../ui';
import { useAuth } from './auth';

const idle = { subscribe: () => () => undefined, getSnapshot: () => null };

/** G05: a sessão expirou com o sync parado; a fila local fica intacta até o novo login. */
export function SessionExpired() {
  const { user, signInWithGoogle } = useAuth();
  const engine: SyncEngine | null = user?.engine ?? null;
  const snapshot = useSyncExternalStore(
    engine?.subscribe ?? idle.subscribe,
    engine?.getSnapshot ?? idle.getSnapshot,
    idle.getSnapshot,
  );
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);
  const open = snapshot?.phase === 'auth' && dismissedAt !== (snapshot.lastSyncAt ?? 'nunca');
  return (
    <Dialog
      open={open}
      title={shellText.sessionExpiredTitle}
      description={shellText.sessionExpiredDescription}
      confirmLabel={shellText.signInGoogle}
      onConfirm={() => void signInWithGoogle()}
      onCancel={() => setDismissedAt(snapshot?.lastSyncAt ?? 'nunca')}
      data-testid="g05"
    />
  );
}
