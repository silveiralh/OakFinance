// G06: toast "1 lançamento foi atualizado a partir de outro aparelho." quando o pull traz edições de outro
// aparelho em lançamentos que já estavam aqui. Um toast por pull (o motor sobe `remoteEditsSeq`).
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { SyncEngine } from '../data/sync/engine';
import { t } from '../i18n/pt-BR';
import { useToast } from '../ui';
import { useAuth } from './auth';

const idle = { subscribe: () => () => undefined, getSnapshot: () => null };

export function remoteEditsMessage(n: number): string {
  return n === 1 ? t('sync.remoteEdited.one') : t('sync.remoteEdited.many', { n });
}

export function RemoteEditsToast() {
  const { user } = useAuth();
  const engine: SyncEngine | null = user?.engine ?? null;
  const snapshot = useSyncExternalStore(
    engine?.subscribe ?? idle.subscribe,
    engine?.getSnapshot ?? idle.getSnapshot,
    idle.getSnapshot,
  );
  const showToast = useToast();
  const shown = useRef(0);
  const seq = snapshot?.remoteEditsSeq ?? 0;
  const count = snapshot?.remoteEdits ?? 0;
  useEffect(() => {
    if (seq > shown.current && count > 0) {
      shown.current = seq;
      showToast({ message: remoteEditsMessage(count), tone: 'info' });
    }
  }, [seq, count, showToast]);
  return null;
}
