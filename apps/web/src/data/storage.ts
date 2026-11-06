// Resiliência do armazenamento no aparelho (tech §4.2 e §4.9, US-64): armazenamento persistente, cota,
// `QuotaExceededError` → G11 e IndexedDB indisponível → G12 (modo só online, sem Dexie).
import { err, ok, type Result } from './result';

export type StorageMode = 'unknown' | 'local' | 'online-only';

export interface StorageStatus {
  /** `online-only`: IndexedDB bloqueado (G12); as leituras passam a vir da RPC. */
  mode: StorageMode;
  /** Última escrita falhou por falta de espaço (G11). Volta a `false` na próxima escrita que funcionar. */
  full: boolean;
  /** Resultado de `navigator.storage.persist()` (Diagnóstico); `null` sem a API. */
  persisted: boolean | null;
}

type Listener = () => void;

const INITIAL: StorageStatus = { mode: 'unknown', full: false, persisted: null };
let status: StorageStatus = INITIAL;
const listeners = new Set<Listener>();

export function getStorageStatus(): StorageStatus {
  return status;
}

export function subscribeStorage(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function update(patch: Partial<StorageStatus>) {
  const next = { ...status, ...patch };
  if (
    next.mode === status.mode &&
    next.full === status.full &&
    next.persisted === status.persisted
  ) {
    return;
  }
  status = next;
  for (const listener of listeners) {
    listener();
  }
}

/** Só para os testes. */
export function resetStorageStatus(): void {
  status = INITIAL;
  listeners.clear();
}

function errorName(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name: unknown }).name)
    : undefined;
}

/** `QuotaExceededError` direto ou embrulhado pelo Dexie (`inner`, ou `AbortError` da transação). */
export function isQuotaExceeded(error: unknown): boolean {
  if (errorName(error) === 'QuotaExceededError') {
    return true;
  }
  if (typeof error === 'object' && error !== null && 'inner' in error) {
    return isQuotaExceeded((error as { inner: unknown }).inner);
  }
  return false;
}

export const PROBE_DB = 'oakfinance__probe';
export const PROBE_TIMEOUT_MS = 3000;

/**
 * IndexedDB utilizável? Abre e apaga um banco de teste. Falha, bloqueio, exceção (navegação privada antiga) ou
 * demora acima de 3 s contam como indisponível.
 */
export function probeIndexedDb(
  factory: IDBFactory | null | undefined = globalThis.indexedDB,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  if (!factory) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      const request = factory.open(PROBE_DB);
      request.onsuccess = () => {
        request.result.close();
        try {
          factory.deleteDatabase(PROBE_DB);
        } catch {
          // o banco de teste sobra; não atrapalha
        }
        finish(true);
      };
      request.onerror = () => finish(false);
      request.onblocked = () => finish(false);
    } catch {
      finish(false);
    }
  });
}

type StorageManagerLike = Pick<StorageManager, 'persist' | 'estimate'> & {
  persisted?: () => Promise<boolean>;
};

function storageManager(): StorageManagerLike | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.storage;
}

/** Pede armazenamento persistente (RN-100); o Chrome concede para a PWA instalada. */
export async function requestPersistence(
  manager: StorageManagerLike | undefined = storageManager(),
): Promise<boolean | null> {
  if (!manager?.persist) {
    return null;
  }
  try {
    const persisted = await manager.persist();
    update({ persisted });
    return persisted;
  } catch {
    return null;
  }
}

export interface StorageEstimate {
  usage: number;
  quota: number;
  /** Uso acima de 80% da cota (alerta no Diagnóstico, tech §4.9). */
  high: boolean;
}

export const HIGH_USAGE_RATIO = 0.8;

export async function estimateStorage(
  manager: StorageManagerLike | undefined = storageManager(),
): Promise<StorageEstimate | null> {
  if (!manager?.estimate) {
    return null;
  }
  try {
    const { usage = 0, quota = 0 } = await manager.estimate();
    return { usage, quota, high: quota > 0 && usage / quota > HIGH_USAGE_RATIO };
  } catch {
    return null;
  }
}

export interface InitStorageOptions {
  /** `null`: navegador sem IndexedDB. */
  indexedDB?: IDBFactory | null | undefined;
  manager?: StorageManagerLike | undefined;
}

/** Na abertura do app: decide o modo (local ou só online) e pede armazenamento persistente. */
export async function initStorage({
  indexedDB = globalThis.indexedDB,
  manager = storageManager(),
}: InitStorageOptions = {}): Promise<StorageStatus> {
  const available = await probeIndexedDb(indexedDB);
  update({ mode: available ? 'local' : 'online-only' });
  if (available) {
    await requestPersistence(manager);
  }
  return status;
}

/**
 * Toda escrita no Dexie passa por aqui: falta de espaço vira `STORAGE_QUOTA` e liga o G11 (quem chamou mantém o
 * que estava sendo digitado); modo só online vira `STORAGE_UNAVAILABLE`.
 */
export async function writeLocal<T>(write: () => Promise<T>): Promise<Result<T>> {
  if (status.mode === 'online-only') {
    return err({ code: 'STORAGE_UNAVAILABLE', message: 'IndexedDB indisponível' });
  }
  try {
    const value = await write();
    update({ full: false });
    return ok(value);
  } catch (error) {
    if (isQuotaExceeded(error)) {
      update({ full: true });
      return err({ code: 'STORAGE_QUOTA', message: 'Armazenamento do aparelho cheio' });
    }
    return err({
      code: 'STORAGE_FAILED',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
