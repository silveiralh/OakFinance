// Motor de sync (tech §4.5–§4.8, RN-96..RN-100): um ciclo = push e depois pull, com Web Locks (um sync por vez
// entre abas), backoff da RN-96 com jitter de ±20% e os gatilhos da §4.8. Roda só na thread principal: o SW
// apenas pede `RUN_SYNC` (tech §4.8).
import { flushTelemetry, track } from '../../lib/telemetry';
import type { OakDb } from '../db';
import { deviceId } from './clock';
import { pendingCount } from './outbox';
import { pullChanges, purgeLocalTombstones, readCursor } from './pull';
import { pushOutbox } from './push';
import { type ReconcileSummary, runReconcile } from './reconcile-runner';
import type { FailureKind, SyncTransport } from './transport';

export const LOCK_NAME = 'oakfinance-sync';
/** Espera da RN-96: 5 s, 15 s, 1 min, 5 min e depois a cada 5 min. */
export const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000] as const;
export const JITTER = 0.2;
/** Escrita local → push com debounce de 2 s (tech §4.8). */
export const WRITE_DEBOUNCE_MS = 2_000;
/** Com o app visível: 60 s com a outbox cheia, 5 min vazia (tech §4.8). */
export const POLL_PENDING_MS = 60_000;
export const POLL_IDLE_MS = 300_000;
/** A partir de 3 falhas seguidas, o banner G04 (tech §4.5, passo 6). */
export const FAILURES_FOR_BANNER = 3;

/** Espera antes da tentativa seguinte, para `failures` falhas seguidas (≥ 1). */
export function backoffDelay(failures: number, random: () => number = Math.random): number {
  const base = BACKOFF_MS[Math.min(Math.max(failures, 1), BACKOFF_MS.length) - 1] ?? BACKOFF_MS[3];
  return Math.round(base * (1 - JITTER + 2 * JITTER * random()));
}

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error' | 'auth' | 'done';

export interface SyncSnapshot {
  phase: SyncPhase;
  pending: number;
  rejected: number;
  consecutiveFailures: number;
  /** G04: falhou 3 vezes seguidas. */
  showErrorBanner: boolean;
  lastSyncAt: string | null;
  /** G18: `created_at` da alteração pendente mais antiga (`null` sem fila). */
  oldestPendingAt: string | null;
  /** G08: pull desde o cursor 0 em andamento ("Recuperando seus dados…"). */
  recovering: boolean;
  /** G06: quantos lançamentos o último pull trouxe editados em outro aparelho. */
  remoteEdits: number;
  /** Sobe a cada pull com `remoteEdits > 0` (o toast do G06 aparece uma vez por pull). */
  remoteEditsSeq: number;
}

export interface LockManagerLike {
  request<T>(
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: unknown) => Promise<T>,
  ): Promise<T>;
}

export interface SyncEngineOptions {
  db: OakDb;
  transport: SyncTransport;
  /** `navigator.locks`; sem a API, um trinco em memória (uma aba). */
  locks?: LockManagerLike | undefined;
  now?: () => number;
  random?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  isOnline?: () => boolean;
  isVisible?: () => boolean;
  appVersion?: string;
}

export interface CycleResult {
  ran: boolean;
  ok: boolean;
  failure: FailureKind | null;
}

function memoryLocks(): LockManagerLike {
  let busy = false;
  return {
    async request(_name, _options, callback) {
      if (busy) {
        return callback(null);
      }
      busy = true;
      try {
        return await callback({});
      } finally {
        busy = false;
      }
    },
  };
}

type Listener = () => void;

export class SyncEngine {
  private readonly db: OakDb;
  private readonly transport: SyncTransport;
  private readonly locks: LockManagerLike;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly isOnline: () => boolean;
  private readonly isVisible: () => boolean;
  private readonly appVersion: string | undefined;
  /** Resumo da última conciliação com importados (I01/I05). */
  reconciled: ReconcileSummary | null = null;
  private timer: unknown = null;
  private debounce: unknown = null;
  private running: Promise<CycleResult> | null = null;
  private stopped = true;
  private readonly listeners = new Set<Listener>();
  private snapshot: SyncSnapshot = {
    phase: 'idle',
    pending: 0,
    rejected: 0,
    consecutiveFailures: 0,
    showErrorBanner: false,
    lastSyncAt: null,
    oldestPendingAt: null,
    recovering: false,
    remoteEdits: 0,
    remoteEditsSeq: 0,
  };

  constructor(options: SyncEngineOptions) {
    this.db = options.db;
    this.transport = options.transport;
    this.locks = options.locks ?? memoryLocks();
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer =
      options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.isOnline =
      options.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine);
    this.isVisible =
      options.isVisible ??
      (() => typeof document === 'undefined' || document.visibilityState === 'visible');
    this.appVersion = options.appVersion;
  }

  getSnapshot = (): SyncSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(patch: Partial<SyncSnapshot>) {
    const next = { ...this.snapshot, ...patch };
    next.showErrorBanner = next.consecutiveFailures >= FAILURES_FOR_BANNER;
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private async refreshCounts() {
    const pending = await pendingCount(this.db);
    const rejected = await this.db.outbox.where('state').equals('rejected').count();
    const oldest = pending
      ? await this.db.outbox.where('state').anyOf(['queued', 'inflight']).sortBy('seq')
      : [];
    this.set({ pending, rejected, oldestPendingAt: oldest[0]?.created_at ?? null });
    return pending;
  }

  /** Um ciclo completo (push → pull → telemetria). Chamadas simultâneas compartilham o mesmo ciclo. */
  syncNow(): Promise<CycleResult> {
    this.running ??= this.cycle().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async cycle(): Promise<CycleResult> {
    this.clearScheduled();
    if (!this.isOnline()) {
      this.set({ phase: 'offline' });
      await this.refreshCounts();
      return { ran: false, ok: false, failure: null };
    }
    const result = await this.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (lock === null) {
        // outra aba já está sincronizando
        return { ran: false, ok: true, failure: null } satisfies CycleResult;
      }
      return this.runLocked();
    });
    await this.refreshCounts();
    this.scheduleAfter(result);
    return result;
  }

  private async runLocked(): Promise<CycleResult> {
    if (!(await this.transport.hasSession())) {
      this.set({ phase: 'auth' });
      return { ran: true, ok: false, failure: 'auth' };
    }
    this.set({ phase: 'syncing' });
    // issue #123: este ciclo já sobe a fila; o debounce de uma escrita anterior viraria um 2º ciclo (pull e
    // releitura ao vivo) que trava a próxima gravação. Escritas que chegarem depois agendam o próprio debounce.
    this.clearDebounce();
    const started = this.now();
    const device = await deviceId(this.db);
    const push = await pushOutbox(this.db, this.transport, device);
    for (const rejected of push.rejected) {
      await this.event('warn', 'sync.rejected', { table: rejected.table, reason: rejected.code });
    }
    if (!push.failure) {
      await this.stamp('last_push_at');
    }
    const failure = push.failure ?? (await this.pullAndClean(device));
    if (!failure) {
      await this.stamp('last_pull_at');
    }
    if (failure) {
      const failures = this.snapshot.consecutiveFailures + 1;
      this.set({
        phase: failure.kind === 'auth' ? 'auth' : 'error',
        consecutiveFailures: failures,
      });
      await this.event('error', 'sync.failed', { reason: failure.code, attempts: failures });
      await this.event('info', 'usage.sync_falha', { codigo: failure.code });
      return { ran: true, ok: false, failure: failure.kind };
    }
    this.set({
      phase: 'done',
      consecutiveFailures: 0,
      lastSyncAt: new Date(this.now()).toISOString(),
    });
    await this.event('info', 'sync.done', {
      batches: push.batches,
      applied: push.applied,
      stale: push.stale,
      rejected: push.rejected.length,
      duration_ms: this.now() - started,
    });
    await this.event('info', 'usage.sync_ok', {});
    await flushTelemetry(this.db, this.transport);
    return { ran: true, ok: true, failure: null };
  }

  private async pullAndClean(device: string) {
    const fromScratch = (await readCursor(this.db)) === 0;
    if (fromScratch) {
      this.set({ recovering: true });
    }
    const pull = await pullChanges(this.db, this.transport, this.now, device).finally(() => {
      if (fromScratch) {
        this.set({ recovering: false });
      }
    });
    if (pull.remoteEdits > 0) {
      this.set({
        remoteEdits: pull.remoteEdits,
        remoteEditsSeq: this.snapshot.remoteEditsSeq + 1,
      });
    }
    if (!pull.failure) {
      await purgeLocalTombstones(this.db, this.now());
      // passo 6 (tech §4.6): conciliação dos importados novos; as escritas vão para a outbox
      const recon = await runReconcile(this.db, { nowMs: this.now() }).catch(() => null);
      if (recon && recon.checked > 0) {
        this.reconciled = recon;
        void this.refreshCounts();
      }
    }
    return pull.failure;
  }

  /** Último envio/recebimento sem falha (`sync_state`, mostrado no Diagnóstico S11). */
  private async stamp(key: 'last_push_at' | 'last_pull_at') {
    try {
      await this.db.sync_state.put({ key, value: new Date(this.now()).toISOString() });
    } catch {
      // só informativo
    }
  }

  private event(level: 'info' | 'warn' | 'error', code: string, context: Record<string, unknown>) {
    return track(this.db, {
      level,
      code,
      context,
      nowMs: this.now(),
      ...(this.appVersion !== undefined && { appVersion: this.appVersion }),
    });
  }

  private clearDebounce() {
    if (this.debounce !== null) {
      this.clearTimer(this.debounce);
      this.debounce = null;
    }
  }

  private clearScheduled() {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  /** Próximo ciclo: backoff depois de falha; 60 s/5 min com o app visível; nada com sessão expirada (G05). */
  private scheduleAfter(result: CycleResult) {
    if (this.stopped || result.failure === 'auth') {
      return;
    }
    let delay: number | null;
    if (result.ran && !result.ok) {
      delay = backoffDelay(this.snapshot.consecutiveFailures, this.random);
    } else if (!this.isVisible()) {
      delay = null;
    } else {
      delay = this.snapshot.pending > 0 ? POLL_PENDING_MS : POLL_IDLE_MS;
    }
    if (delay !== null) {
      this.timer = this.setTimer(() => {
        this.timer = null;
        void this.syncNow();
      }, delay);
    }
  }

  /** Escrita local: push com debounce de 2 s. */
  notifyWrite(): void {
    void this.refreshCounts();
    this.clearDebounce();
    this.debounce = this.setTimer(() => {
      this.debounce = null;
      void this.syncNow();
    }, WRITE_DEBOUNCE_MS);
  }

  /** Liga os gatilhos (abertura, `online`, `visibilitychange` → visível, `focus`, `RUN_SYNC` do SW). */
  start(
    target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
    doc:
      | Pick<Document, 'addEventListener' | 'removeEventListener'>
      | undefined = globalThis.document,
  ): () => void {
    this.stopped = false;
    const run = () => void this.syncNow();
    const onVisibility = () => {
      if (this.isVisible()) {
        run();
      }
    };
    const onMessage = (event: Event) => {
      const data = (event as MessageEvent).data as { type?: unknown } | null;
      if (data?.type === 'RUN_SYNC') {
        run();
      }
    };
    const offline = () => this.set({ phase: 'offline' });
    target.addEventListener('online', run);
    target.addEventListener('offline', offline);
    target.addEventListener('focus', run);
    doc?.addEventListener('visibilitychange', onVisibility);
    const sw = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
    sw?.addEventListener('message', onMessage);
    run();
    return () => {
      this.stopped = true;
      this.clearScheduled();
      this.clearDebounce();
      target.removeEventListener('online', run);
      target.removeEventListener('offline', offline);
      target.removeEventListener('focus', run);
      doc?.removeEventListener('visibilitychange', onVisibility);
      sw?.removeEventListener('message', onMessage);
    };
  }
}

/** Web Locks do navegador, quando existem. */
export function browserLocks(): LockManagerLike | undefined {
  return typeof navigator !== 'undefined' && navigator.locks
    ? (navigator.locks as unknown as LockManagerLike)
    : undefined;
}
