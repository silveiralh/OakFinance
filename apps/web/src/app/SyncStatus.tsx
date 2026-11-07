// Estados de sincronização na moldura (UX §2.6, §3 G): SyncBadge no topo, banners G01 (sem internet, some em 4 s),
// G04 (3 falhas seguidas, com Tentar novamente), G18 (pendência há mais de 24 h), "Recuperando seus dados…" (pull do
// zero), o diálogo G08 (cópia local apagada pelo sistema) e o banner G15 (rejeitadas) do Início.
import { CloudDownload, CloudOff, CloudUpload, TriangleAlert } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';
import type { SyncEngine, SyncSnapshot } from '../data/sync/engine';
import { shellText } from '../i18n/pt-BR';
import { hadLocalData, markLocalData } from '../lib/local-marker';
import { useOnline } from '../lib/online';
import { Banner, Dialog, SyncBadge, type SyncState } from '../ui';
import { useAuth } from './auth';

/** G01: o banner some depois de 4 s; fica o SyncBadge. */
export const OFFLINE_BANNER_MS = 4000;
/** G18: pendência local mais antiga que 24 h. */
export const STALE_PENDING_MS = 24 * 60 * 60 * 1000;

const idle = { subscribe: () => () => undefined, getSnapshot: () => null };

export function useSyncSnapshot(): SyncSnapshot | null {
  const { user } = useAuth();
  const engine: SyncEngine | null = user?.engine ?? null;
  return useSyncExternalStore(
    engine?.subscribe ?? idle.subscribe,
    engine?.getSnapshot ?? idle.getSnapshot,
    idle.getSnapshot,
  );
}

/** Estado do SyncBadge (UX §2.6): sem rede → offline; 3 falhas → erro; ciclo → sincronizando; fila → pendente. */
export function badgeState(snapshot: SyncSnapshot | null, online: boolean): SyncState {
  if (!online || snapshot?.phase === 'offline') {
    return 'offline';
  }
  if (!snapshot) {
    return 'synced';
  }
  if (snapshot.showErrorBanner) {
    return 'error';
  }
  if (snapshot.phase === 'syncing') {
    return 'syncing';
  }
  return snapshot.pending > 0 ? 'pending' : 'synced';
}

export function syncFailedText(n: number): string {
  return n === 1 ? shellText.syncFailedOne : shellText.syncFailedMany.replace('{n}', String(n));
}

export function rejectedText(n: number): string {
  return n === 1 ? shellText.rejectedOne : shellText.rejectedMany.replace('{n}', String(n));
}

/** Pendência mais antiga que 24 h (G18). */
export function isStalePending(snapshot: SyncSnapshot | null, nowMs: number): boolean {
  if (!snapshot?.oldestPendingAt) {
    return false;
  }
  const at = Date.parse(snapshot.oldestPendingAt);
  return Number.isFinite(at) && nowMs - at > STALE_PENDING_MS;
}

/** SyncBadge do topo: tocar sincroniza agora. */
export function ShellSyncBadge() {
  const { user } = useAuth();
  const snapshot = useSyncSnapshot();
  const online = useOnline();
  if (!user) {
    return null;
  }
  return (
    <SyncBadge
      state={badgeState(snapshot, online)}
      pendingCount={snapshot?.pending ?? 0}
      onPress={() => void user.engine.syncNow()}
      data-testid="sync-badge"
    />
  );
}

/** Banners globais de sync, abaixo do topo. */
export function SyncBanners({ now = Date.now }: { now?: () => number }) {
  const { user } = useAuth();
  const snapshot = useSyncSnapshot();
  const online = useOnline();
  const offline = !online || snapshot?.phase === 'offline';
  const [offlineShown, setOfflineShown] = useState(false);
  useEffect(() => {
    if (!offline) {
      setOfflineShown(false);
      return;
    }
    setOfflineShown(true);
    const timer = setTimeout(() => setOfflineShown(false), OFFLINE_BANNER_MS);
    return () => clearTimeout(timer);
  }, [offline]);
  if (!user) {
    return null;
  }
  return (
    <div className="shell-banners" data-testid="sync-banners">
      {offlineShown && (
        <Banner icon={CloudOff} message={shellText.offlineBanner} data-testid="g01" />
      )}
      {snapshot?.showErrorBanner && !offline && (
        <Banner
          tone="warning"
          icon={TriangleAlert}
          message={syncFailedText(snapshot.pending)}
          action={{ label: shellText.retry, onPress: () => void user.engine.syncNow() }}
          data-testid="g04"
        />
      )}
      {snapshot?.recovering && (
        <Banner icon={CloudDownload} message={shellText.recovering} data-testid="g08-recovering" />
      )}
      {isStalePending(snapshot, now()) && (
        <Banner icon={CloudUpload} message={shellText.stalePending} data-testid="g18" />
      )}
    </div>
  );
}

/**
 * G08: o aparelho já teve a cópia local (marca fora do IndexedDB) e o banco abriu vazio. "Baixar agora" sincroniza;
 * a marca é gravada depois de cada sync que dá certo.
 */
export function WipedDialog() {
  const { user } = useAuth();
  const snapshot = useSyncSnapshot();
  const [wiped, setWiped] = useState(false);
  useEffect(() => {
    if (!user) {
      return;
    }
    let alive = true;
    void user.db.sync_state.get('cursor').then((entry) => {
      const cursor = typeof entry?.value === 'number' ? entry.value : 0;
      if (alive && cursor === 0 && hadLocalData(user.userId)) {
        setWiped(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [user]);
  const done = snapshot?.phase === 'done';
  useEffect(() => {
    if (user && done) {
      markLocalData(user.userId);
    }
  }, [user, done]);
  if (!user) {
    return null;
  }
  return (
    <Dialog
      open={wiped}
      title={shellText.wipedTitle}
      description={shellText.wipedDescription}
      confirmLabel={shellText.downloadNow}
      onConfirm={() => {
        setWiped(false);
        void user.engine.syncNow();
      }}
      onCancel={() => setWiped(false)}
      data-testid="g08"
    />
  );
}

/** G15: banner discreto no Início com as alterações rejeitadas; "Ver detalhes" leva ao Diagnóstico (S11). */
export function RejectedBanner() {
  const snapshot = useSyncSnapshot();
  const navigate = useNavigate();
  const rejected = snapshot?.rejected ?? 0;
  if (rejected === 0) {
    return null;
  }
  return (
    <Banner
      tone="warning"
      icon={TriangleAlert}
      message={rejectedText(rejected)}
      action={{ label: shellText.seeDetails, onPress: () => void navigate('/ajustes/diagnostico') }}
      data-testid="g15"
    />
  );
}
