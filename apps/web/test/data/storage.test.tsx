import { render, screen } from '@testing-library/react';
import { Dexie } from 'dexie';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageBanners } from '../../src/app/StorageBanners';
import { OakDb } from '../../src/data/db';
import {
  clearDraft,
  flushDrafts,
  loadDraft,
  resetDrafts,
  saveDraft,
  unsavedDrafts,
} from '../../src/data/drafts';
import {
  estimateStorage,
  getStorageStatus,
  initStorage,
  isQuotaExceeded,
  probeIndexedDb,
  requestPersistence,
  resetStorageStatus,
  subscribeStorage,
  writeLocal,
} from '../../src/data/storage';

const quota = () => new DOMException('sem espaço', 'QuotaExceededError');

const opened: OakDb[] = [];
function open(name: string) {
  const db = new OakDb(name);
  opened.push(db);
  return db;
}

afterEach(async () => {
  resetStorageStatus();
  resetDrafts();
  vi.useRealTimers();
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

/** IDBFactory falso: `open` dispara o evento pedido (ou lança). */
function fakeFactory(behavior: 'success' | 'error' | 'blocked' | 'throw' | 'hang'): IDBFactory {
  return {
    open: () => {
      if (behavior === 'throw') {
        throw new DOMException('negado', 'SecurityError');
      }
      const request: Record<string, unknown> = {
        result: { close: vi.fn() },
      };
      setTimeout(() => {
        const handler = { success: 'onsuccess', error: 'onerror', blocked: 'onblocked' }[
          behavior as 'success'
        ];
        (request[handler] as (() => void) | undefined)?.();
      }, 0);
      return request as unknown as IDBOpenDBRequest;
    },
    deleteDatabase: () => {
      throw new Error('sem permissão');
    },
  } as unknown as IDBFactory;
}

describe('US-64: erros de armazenamento (tech §4.2)', () => {
  it('reconhece QuotaExceededError direto e embrulhado pelo Dexie', () => {
    expect(isQuotaExceeded(quota())).toBe(true);
    expect(isQuotaExceeded({ name: 'AbortError', inner: { name: 'QuotaExceededError' } })).toBe(
      true,
    );
    expect(isQuotaExceeded(new Dexie.QuotaExceededError('cheio'))).toBe(true);
    expect(isQuotaExceeded(new Error('outro'))).toBe(false);
    expect(isQuotaExceeded(null)).toBe(false);
  });

  it('G11: escrita sem espaço liga o aviso, não lança, e a próxima escrita que funciona desliga', async () => {
    const changes = vi.fn();
    subscribeStorage(changes);
    const failed = await writeLocal(() => Promise.reject(quota()));
    expect(failed).toEqual({
      ok: false,
      error: { code: 'STORAGE_QUOTA', message: 'Armazenamento do aparelho cheio' },
    });
    expect(getStorageStatus().full).toBe(true);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(await writeLocal(() => Promise.resolve(7))).toEqual({ ok: true, value: 7 });
    expect(getStorageStatus().full).toBe(false);
    const other = await writeLocal(() => Promise.reject(new Error('quebrou')));
    expect(other).toEqual({ ok: false, error: { code: 'STORAGE_FAILED', message: 'quebrou' } });
    expect(await writeLocal(() => Promise.reject('texto'))).toMatchObject({
      error: { message: 'texto' },
    });
  });

  it('G11: o rascunho do lançamento fica em memória e vai para o kv quando houver espaço', async () => {
    const db = open('drafts');
    const put = vi.spyOn(db.kv, 'put').mockRejectedValueOnce(quota());
    const draft = { amountCents: 1250, categoryId: 'mercado' };
    expect(await saveDraft(db, 'quick', draft)).toEqual({ ok: true, value: 'memory' });
    expect(unsavedDrafts()).toEqual(['quick']);
    expect(await loadDraft(db, 'quick')).toEqual(draft);
    expect(await db.kv.get('draft:quick')).toBeUndefined();
    put.mockRestore();
    expect(await flushDrafts(db)).toBe(0);
    expect(await db.kv.get('draft:quick')).toEqual({ key: 'draft:quick', value: draft });
    resetDrafts();
    expect(await loadDraft(db, 'quick')).toEqual(draft);
    await clearDraft(db, 'quick');
    expect(await loadDraft(db, 'quick')).toBeUndefined();
  });

  it('erro inesperado ao gravar o rascunho chega a quem chamou', async () => {
    const db = open('drafts-err');
    vi.spyOn(db.kv, 'put').mockRejectedValueOnce(new Error('disco'));
    expect(await saveDraft(db, 'quick', 1)).toMatchObject({
      ok: false,
      error: { code: 'STORAGE_FAILED' },
    });
  });

  it('G12: IndexedDB indisponível na abertura → modo só online; escritas recusadas, rascunho em memória', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    const status = await initStorage({
      indexedDB: fakeFactory('throw'),
      manager: { persist, estimate: vi.fn() },
    });
    expect(status.mode).toBe('online-only');
    expect(persist).not.toHaveBeenCalled();
    expect(await writeLocal(() => Promise.resolve(1))).toMatchObject({
      ok: false,
      error: { code: 'STORAGE_UNAVAILABLE' },
    });
    const db = open('g12');
    expect(await saveDraft(db, 'quick', { amountCents: 5 })).toEqual({ ok: true, value: 'memory' });
  });

  it('IndexedDB disponível → modo local e pede armazenamento persistente (RN-100)', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    const status = await initStorage({ manager: { persist, estimate: vi.fn() } });
    expect(status).toEqual({ mode: 'local', full: false, persisted: true });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('probeIndexedDb: sucesso, erro, bloqueio, exceção, ausência e demora', async () => {
    expect(await probeIndexedDb(globalThis.indexedDB)).toBe(true);
    expect(await probeIndexedDb(fakeFactory('success'))).toBe(true);
    expect(await probeIndexedDb(fakeFactory('error'))).toBe(false);
    expect(await probeIndexedDb(fakeFactory('blocked'))).toBe(false);
    expect(await probeIndexedDb(fakeFactory('throw'))).toBe(false);
    expect(await probeIndexedDb(null)).toBe(false);
    vi.useFakeTimers();
    const pending = probeIndexedDb(fakeFactory('hang'), 50);
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toBe(false);
  });

  it('persist() e estimate(): ausência da API, erro e alerta acima de 80% da cota (tech §4.9)', async () => {
    expect(await requestPersistence(undefined)).toBeNull();
    expect(
      await requestPersistence({
        persist: () => Promise.reject(new Error('x')),
        estimate: vi.fn(),
      }),
    ).toBeNull();
    expect(
      await requestPersistence({ persist: () => Promise.resolve(false), estimate: vi.fn() }),
    ).toBe(false);
    expect(getStorageStatus().persisted).toBe(false);
    const manager = (usage: number, quotaBytes: number) => ({
      persist: vi.fn(),
      estimate: () => Promise.resolve({ usage, quota: quotaBytes }),
    });
    expect(await estimateStorage(manager(81, 100))).toEqual({ usage: 81, quota: 100, high: true });
    expect(await estimateStorage(manager(80, 100))).toMatchObject({ high: false });
    expect(await estimateStorage(manager(0, 0))).toMatchObject({ high: false });
    expect(
      await estimateStorage({ persist: vi.fn(), estimate: () => Promise.resolve({}) }),
    ).toEqual({
      usage: 0,
      quota: 0,
      high: false,
    });
    expect(
      await estimateStorage({ persist: vi.fn(), estimate: () => Promise.reject(new Error('x')) }),
    ).toBeNull();
    expect(await estimateStorage(undefined)).toBeNull();
  });

  it('banners G11 e G12 com os textos da UX §3 G', async () => {
    render(<StorageBanners />);
    expect(screen.queryByTestId('g11')).not.toBeInTheDocument();
    await act(() => writeLocal(() => Promise.reject(quota())));
    expect(screen.getByTestId('g11')).toHaveTextContent(
      'O armazenamento do aparelho está cheio. Libere espaço para continuar lançando.',
    );
    await act(() => initStorage({ indexedDB: fakeFactory('throw') }));
    expect(screen.getByTestId('g12')).toHaveTextContent(
      'Este navegador bloqueou o armazenamento local. Abra pelo app instalado.',
    );
  });
});
