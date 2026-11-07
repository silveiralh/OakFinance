// T-071: Diagnóstico (S11, US-64), telemetria da RN-104 (allowlist, sem valores) e captura de erros (tech §7.3).
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppTelemetry, resetAppOpened } from '../src/app/AppTelemetry';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { OakDb, OutboxEntry } from '../src/data/db';
import { discardRejected, retryRejected } from '../src/data/sync/outbox';
import {
  DiagnosticsScreen,
  formatBytes,
  formatStamp,
} from '../src/features/settings/DiagnosticsScreen';
import {
  captureErrors,
  EVENT_CODES,
  recentEvents,
  TELEMETRY_KEY,
  TELEMETRY_RECENT,
  type TelemetryEvent,
  track,
  trackUsage,
  USAGE_EVENTS,
} from '../src/lib/telemetry';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { tx } from './data/rows';

function dbOf(auth: AuthValue): OakDb {
  const db = auth.user?.db;
  if (!db) {
    throw new Error('sem sessão');
  }
  return db;
}

async function queue(db: OakDb): Promise<TelemetryEvent[]> {
  return ((await db.kv.get(TELEMETRY_KEY))?.value ?? []) as TelemetryEvent[];
}

function entry(overrides: Partial<OutboxEntry>): OutboxEntry {
  return {
    mutation_id: 'm-1',
    table: 'transactions',
    row_id: 'tx-1',
    row: { id: 'tx-1' },
    state: 'rejected',
    attempts: 2,
    last_error: '23503',
    created_at: '2026-11-07T12:30:00.000Z',
    ...overrides,
  };
}

function renderScreen(auth: AuthValue) {
  const router = createMemoryRouter([{ path: '/', element: <DiagnosticsScreen /> }], {
    initialEntries: ['/'],
  });
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  resetAppOpened();
  vi.restoreAllMocks();
});

describe('telemetria da RN-104', () => {
  it('RN-104: os 9 eventos de uso vão como usage.<nome> e só códigos da allowlist entram', async () => {
    expect(USAGE_EVENTS).toEqual([
      'app_aberto',
      'lancamento_iniciado',
      'lancamento_salvo',
      'sync_ok',
      'sync_falha',
      'importacao_concluida',
      'mes_fechado',
      'push_recebido',
      'regra_corrigida',
    ]);
    for (const name of USAGE_EVENTS) {
      expect(EVENT_CODES).toContain(`usage.${name}`);
    }
    const db = dbOf(fakeAuth());
    expect(await track(db, { code: 'usage.qualquer_coisa' })).toBe(false);
    expect(await track(db, { code: 'lancamento_salvo' })).toBe(false);
    expect(
      await trackUsage(db, 'importacao_concluida', {
        fonte: 'ofx',
        novas: 3,
        conciliadas: 2,
        pendentes: 1,
        amount_cents: 4590,
        description: 'PADARIA SOL',
      }),
    ).toBe(true);
    expect(await trackUsage(db, 'sync_falha', { codigo: 'TIMEOUT' })).toBe(true);
    expect(await trackUsage(db, 'push_recebido', { tipo: 'invoice_due' })).toBe(true);
    const events = await queue(db);
    expect(events.map((e) => e.code)).toEqual([
      'usage.importacao_concluida',
      'usage.sync_falha',
      'usage.push_recebido',
    ]);
    expect(events[0]?.context).toEqual({ fonte: 'ofx', novas: 3, conciliadas: 2, pendentes: 1 });
    // RN-104: sem valores monetários nem descrições
    expect(JSON.stringify(events)).not.toMatch(/4590|PADARIA/);
  });

  it('US-64: o aparelho guarda os últimos 20 eventos, do mais novo para o mais antigo', async () => {
    const db = dbOf(fakeAuth());
    for (let i = 0; i < TELEMETRY_RECENT + 5; i += 1) {
      await track(db, { code: 'sync.done', nowMs: i * 1000 });
    }
    const recent = await recentEvents(db);
    expect(recent).toHaveLength(20);
    expect(recent[0]?.at).toBe(new Date(24_000).toISOString());
    expect(recent.at(-1)?.at).toBe(new Date(5_000).toISOString());
  });

  it('tech §7.3: window.onerror e unhandledrejection viram eventos só com o nome do erro', async () => {
    const db = dbOf(fakeAuth());
    const target = new EventTarget();
    const stop = captureErrors(db, target, '1.2.3');
    const error = Object.assign(new Event('error'), {
      error: new TypeError('saldo 4590 de PADARIA SOL'),
    });
    target.dispatchEvent(error);
    const rejection = Object.assign(new Event('unhandledrejection'), {
      reason: new RangeError('x'),
    });
    target.dispatchEvent(rejection);
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'texto' }));
    await waitFor(async () => expect(await queue(db)).toHaveLength(3));
    const events = await queue(db);
    expect(events.map((e) => [e.level, e.code, e.context.reason, e.app_version])).toEqual([
      ['error', 'error.uncaught', 'TypeError', '1.2.3'],
      ['error', 'error.unhandled', 'RangeError', '1.2.3'],
      ['error', 'error.unhandled', 'string', '1.2.3'],
    ]);
    expect(JSON.stringify(events)).not.toMatch(/4590|PADARIA/);
    stop();
    target.dispatchEvent(new Event('error'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await queue(db)).toHaveLength(3);
  });

  it('RN-104: app_aberto uma vez por abertura do app', async () => {
    const auth = fakeAuth();
    const db = dbOf(auth);
    const view = render(
      <AuthContext.Provider value={auth}>
        <AppTelemetry />
      </AuthContext.Provider>,
    );
    await waitFor(async () =>
      expect((await queue(db)).map((e) => e.code)).toEqual(['usage.app_aberto']),
    );
    view.unmount();
    render(
      <AuthContext.Provider value={auth}>
        <AppTelemetry />
      </AuthContext.Provider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await queue(db)).filter((e) => e.code === 'usage.app_aberto')).toHaveLength(1);
  });
});

describe('alterações rejeitadas (US-64, tech §4.4)', () => {
  it('US-64: Tentar de novo volta para a fila com mutation_id novo', async () => {
    const db = dbOf(fakeAuth());
    await db.outbox.add(entry({}));
    expect(await retryRejected(db, 'm-1', () => 'm-2')).toBe(true);
    const [retried] = await db.outbox.toArray();
    expect(retried).toMatchObject({ mutation_id: 'm-2', state: 'queued', attempts: 0 });
    expect(retried?.last_error).toBeUndefined();
    expect(await retryRejected(db, 'm-2')).toBe(false);
    expect(await retryRejected(db, 'nao-existe')).toBe(false);
  });

  it('US-64: Descartar e restaurar tira a entrada, apaga a cópia local e volta o cursor a 0', async () => {
    const db = dbOf(fakeAuth());
    await db.transactions.bulkPut([tx('tx-1', { _pending: 1 }), tx('tx-2', { _pending: 1 })]);
    await db.sync_state.put({ key: 'cursor', value: 42 });
    await db.outbox.bulkAdd([
      entry({}),
      entry({ mutation_id: 'm-3', row_id: 'tx-2' }),
      entry({ mutation_id: 'm-4', row_id: 'tx-2', state: 'queued' }),
    ]);
    expect(await discardRejected(db, 'm-1')).toBe(true);
    expect(await db.transactions.get('tx-1')).toBeUndefined();
    expect((await db.sync_state.get('cursor'))?.value).toBe(0);
    // com outra alteração da mesma linha na fila, a cópia local fica
    expect(await discardRejected(db, 'm-3')).toBe(true);
    expect(await db.transactions.get('tx-2')).toBeDefined();
    expect((await db.outbox.toArray()).map((e) => e.mutation_id)).toEqual(['m-4']);
    expect(await discardRejected(db, 'm-4')).toBe(false);
  });
});

describe('S11 — Diagnóstico (US-64)', () => {
  it('formatos de data e de espaço', () => {
    expect(formatStamp('2026-11-07T05:06:00.000Z')).toBe('07/11/2026 02:06');
    expect(formatStamp(null)).toBe('Nunca');
    expect(formatStamp('ontem')).toBe('Nunca');
    expect(formatBytes(512)).toBe('0,5 KB');
    expect(formatBytes(12.34 * 1024 * 1024)).toBe('12,3 MB');
  });

  it('US-64: mostra versão, aparelho, sync, rejeitadas com as ações e os últimos eventos', async () => {
    const auth = fakeAuth();
    const db = dbOf(auth);
    const syncNow = vi
      .spyOn(auth.user?.engine as NonNullable<AuthValue['user']>['engine'], 'syncNow')
      .mockResolvedValue({ ran: true, ok: true, failure: null });
    await db.sync_state.bulkPut([
      { key: 'device_id', value: 'aparelho-1' },
      { key: 'cursor', value: 17 },
      { key: 'last_push_at', value: '2026-11-07T05:06:00.000Z' },
    ]);
    await db.transactions.put(tx('tx-1', { _pending: 1 }));
    await db.outbox.bulkAdd([entry({}), entry({ mutation_id: 'm-9', row_id: 'tx-9' })]);
    await track(db, { code: 'sync.done', nowMs: Date.parse('2026-11-07T05:00:00.000Z') });
    renderScreen(auth);

    expect((await screen.findByTestId('diag-version')).textContent).toBe('0.0.0-dev');
    await waitFor(() => expect(screen.getByTestId('diag-device').textContent).toBe('aparelho-1'));
    expect(screen.getByTestId('diag-cursor').textContent).toBe('17');
    expect(screen.getByTestId('diag-last-push').textContent).toBe('07/11/2026 02:06');
    expect(screen.getByTestId('diag-last-pull').textContent).toBe('Nunca');
    expect(screen.getByTestId('diag-events').textContent).toContain('sync.done · 07/11/2026 02:00');
    const items = screen.getAllByTestId('diag-rejected-item');
    expect(items[0]?.textContent).toContain('transactions · código 23503 · 07/11/2026 09:30');

    fireEvent.click(screen.getAllByRole('button', { name: 'Tentar de novo' })[0] as HTMLElement);
    await waitFor(async () =>
      expect((await db.outbox.where('state').equals('queued').toArray()).length).toBe(1),
    );
    expect(syncNow).toHaveBeenCalled();
    expect(await screen.findByText('Alteração enviada de novo.')).toBeDefined();
    await waitFor(() => expect(screen.getAllByTestId('diag-rejected-item')).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Descartar e restaurar do servidor' }));
    expect(await screen.findByTestId('diag-rejected-none')).toBeDefined();
    expect(await db.outbox.where('mutation_id').equals('m-9').count()).toBe(0);
    expect(screen.getByTestId('diag-cursor').textContent).toBe('0');
  });
});
