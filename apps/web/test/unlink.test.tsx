// T-081: desfazer conciliação (US-51, RN-73): "Não é o mesmo" restaura o manual pelo histórico e "Não é duplicada"
// separa a duplicata entre fontes.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { LocalRow, OakDb } from '../src/data/db';
import { APART_KEY } from '../src/data/sync/reconcile-runner';
import { LinkActions } from '../src/features/inbox/LinkActions';
import {
  categoryContext,
  notDuplicate,
  unlinkRestoring,
  versionBeforeMerge,
} from '../src/features/inbox/model';
import type { HistoryEntry } from '../src/features/transactions/history';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

type Row = LocalRow<'transactions'>;

function dbOf(auth: AuthValue): OakDb {
  const db = auth.user?.db;
  if (!db) {
    throw new Error('sem sessão');
  }
  return db;
}

const MANUAL_BEFORE = tx('L', {
  account_id: 'bb',
  payment_method: 'debit',
  amount_cents: 5000,
  occurred_on: '2026-11-05',
  description: 'Padaria',
  category_id: 'mercado',
  matched_external: false,
  status: 'pending',
});
const MANUAL_MERGED: Row = {
  ...MANUAL_BEFORE,
  amount_cents: 5150,
  matched_external: true,
  status: 'posted',
};
const IMPORTED: Row = tx('T', {
  account_id: 'bb',
  payment_method: 'debit',
  amount_cents: 5150,
  occurred_on: '2026-11-05',
  source: 'pluggy',
  external_id: 'ext-T',
  description: 'PADARIA EXEMPLO',
  review_state: 'merged',
  duplicate_of: 'L',
  category_id: 'mercado',
});

const HISTORY: HistoryEntry[] = [
  // mais recente primeiro: a conciliação substituiu a versão sem vínculo
  {
    op: 'update',
    oldRow: { ...MANUAL_BEFORE },
    rejectedRow: null,
    deviceId: 'd1',
    changedAt: '2026-11-06T10:00:00Z',
  },
  {
    op: 'update',
    oldRow: { ...MANUAL_BEFORE, amount_cents: 4000, description: 'Padária' },
    rejectedRow: null,
    deviceId: 'd1',
    changedAt: '2026-11-05T10:00:00Z',
  },
];

async function seed(db: OakDb) {
  await db.categories.bulkPut([
    makeRow('categories', {
      id: 'mercado',
      slug: 'mercado',
      kind: 'expense',
      bucket: 'needs',
      deleted_at: null,
    }),
    makeRow('categories', {
      id: 'lazer',
      slug: 'lazer',
      kind: 'expense',
      bucket: 'wants',
      deleted_at: null,
    }),
  ]);
  await db.category_rules.put(
    makeRow('category_rules', {
      id: 'regra',
      category_id: 'lazer',
      match_field: 'description',
      match_type: 'token_prefix',
      pattern: 'PADARIA EXEMPLO',
      source: 'learned',
      enabled: true,
      account_id: null,
      card_id: null,
      payment_method: null,
      deleted_at: null,
    }),
  );
  await db.transactions.bulkPut([MANUAL_MERGED, IMPORTED]);
}

describe('US-51 / RN-73', () => {
  it('a versão anterior à conciliação é a mais recente sem vínculo', () => {
    expect(versionBeforeMerge(HISTORY)?.amount_cents).toBe(5000);
    expect(versionBeforeMerge([])).toBeNull();
    expect(
      versionBeforeMerge([{ ...HISTORY[0], oldRow: { matched_external: true } } as HistoryEntry]),
    ).toBeNull();
  });

  it('US-51: Separar — o manual volta à versão anterior e o importado vira novo com a categoria da regra', async () => {
    const db = dbOf(fakeAuth());
    await seed(db);
    await unlinkRestoring(db, IMPORTED, MANUAL_MERGED, HISTORY, await categoryContext(db));
    const l = await db.transactions.get('L');
    expect([l?.amount_cents, l?.matched_external, l?.status, l?.description]).toEqual([
      5000,
      false,
      'pending',
      'Padaria',
    ]);
    const t = await db.transactions.get('T');
    expect([
      t?.review_state,
      t?.duplicate_of,
      t?.category_id,
      t?.category_source,
      t?.category_rule_id,
    ]).toEqual(['new', null, 'lazer', 'rule', 'regra']);
    expect((await db.kv.get(APART_KEY))?.value).toEqual(['T']);
  });

  it('RN-73: sem histórico (offline), o manual só perde o vínculo', async () => {
    const db = dbOf(fakeAuth());
    await seed(db);
    await unlinkRestoring(db, IMPORTED, MANUAL_MERGED, null, await categoryContext(db));
    const l = await db.transactions.get('L');
    expect([l?.amount_cents, l?.matched_external]).toEqual([5150, false]);
  });

  it('US-51: Desfazer duplicidade — "Não é duplicada" vira um lançamento próprio', async () => {
    const db = dbOf(fakeAuth());
    const dup: Row = {
      ...IMPORTED,
      id: 'O',
      source: 'ofx',
      external_id: 'fitid',
      duplicate_of: 'T',
    };
    await db.transactions.put(dup);
    await notDuplicate(db, dup, { rules: [], categories: [] });
    const o = await db.transactions.get('O');
    expect([o?.review_state, o?.duplicate_of, o?.category_id]).toEqual(['new', null, 'mercado']);
  });
});

describe('T02 — vínculo de conferência (US-51)', () => {
  function mount(auth: AuthValue, row: Row) {
    render(
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <LinkActions tx={row} />
        </ToastProvider>
      </AuthContext.Provider>,
    );
  }

  it('US-51: "Vinculado a" no manual e "Não é o mesmo" restaura pelo histórico do servidor', async () => {
    const calls: unknown[] = [];
    const client = {
      rpc: (fn: string, args: unknown) => {
        calls.push([fn, args]);
        return Promise.resolve({
          data: HISTORY.map((h) => ({
            op: h.op,
            old_row: h.oldRow,
            rejected_row: null,
            device_id: h.deviceId,
            changed_at: h.changedAt,
          })),
          error: null,
        });
      },
    };
    const auth = fakeAuth('signedIn', { client: client as never });
    const db = dbOf(auth);
    await seed(db);
    mount(auth, MANUAL_MERGED);
    expect(await screen.findByText('Vinculado a: PADARIA EXEMPLO')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Não é o mesmo' }));
    await waitFor(async () => expect((await db.transactions.get('L'))?.amount_cents).toBe(5000));
    expect(calls).toEqual([['get_row_history', { p_table: 'transactions', p_row_id: 'L' }]]);
    expect(await screen.findByText('Vínculo desfeito.')).toBeDefined();
  });

  it('US-51: na duplicata, "Duplicada de" e "Não é duplicada"; sem vínculo, nada aparece', async () => {
    const auth = fakeAuth();
    const db = dbOf(auth);
    await seed(db);
    const dup: Row = {
      ...IMPORTED,
      id: 'O',
      source: 'ofx',
      external_id: 'fitid',
      duplicate_of: 'T',
    };
    await db.transactions.put(dup);
    mount(auth, dup);
    expect(await screen.findByText('Duplicada de: PADARIA EXEMPLO')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Não é duplicada' }));
    await waitFor(async () => expect((await db.transactions.get('O'))?.review_state).toBe('new'));
    expect(await screen.findByText('Lançamento separado.')).toBeDefined();
  });

  it('lançamento sem vínculo não mostra o bloco', async () => {
    const auth = fakeAuth();
    mount(auth, MANUAL_BEFORE);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByTestId('detail-link')).toBeNull();
  });
});
