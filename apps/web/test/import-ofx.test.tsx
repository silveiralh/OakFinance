// T-084: importar OFX (US-52; RN-65, RN-75, RN-78; E07 com a fixture sintética do BB).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { LocalRow, OakDb } from '../src/data/db';
import {
  commitImport,
  type Destination,
  parseOfxBytes,
  planImport,
  previousImport,
  rememberedDestination,
  sha256Hex,
  UNDO_WINDOW_MS,
  undoable,
  undoImport,
} from '../src/features/imports/ofx-import';
import { ImportScreen } from '../src/features/imports/screens';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

const here = dirname(fileURLToPath(import.meta.url));
const BB = new Uint8Array(
  readFileSync(join(here, '../../../packages/domain/test/fixtures/bb-sgml-1252.ofx')),
);
const realFixture = (name: string) =>
  new Uint8Array(readFileSync(join(here, '../../../packages/domain/test/fixtures', name)));
const REAL = realFixture('bb-real-anon.ofx');
const REAL_EMPTY = realFixture('bb-real-anon-sem-movimento.ofx');
const CARD_OFX = new Uint8Array(
  readFileSync(join(here, '../../../packages/domain/test/fixtures/cartao-ofx2-utf8.ofx')),
);
const NOW = Date.parse('2026-11-06T15:00:00.000Z');

function dbOf(auth: AuthValue): OakDb {
  const db = auth.user?.db;
  if (!db) {
    throw new Error('sem sessão');
  }
  return db;
}

async function plan(
  db: OakDb,
  userId: string,
  bytes = BB,
  destination: Destination = { kind: 'account', id: 'bb' },
) {
  const parsed = parseOfxBytes(bytes);
  if (!parsed.ok) {
    throw new Error(parsed.code);
  }
  const statement = parsed.statements[0];
  if (!statement) {
    throw new Error('sem extrato');
  }
  return {
    statement,
    plan: planImport({
      userId,
      statement,
      destination,
      fileName: 'extrato.ofx',
      sha: await sha256Hex(bytes),
      txs: await db.transactions.toArray(),
      invoices: await db.invoices.toArray(),
      cards: await db.cards.toArray(),
      recurrences: await db.recurrences.toArray(),
      nowMs: NOW,
    }),
  };
}

function manuals(): LocalRow<'transactions'>[] {
  return [
    tx('agua', {
      account_id: 'bb',
      payment_method: 'debit',
      amount_cents: 8790,
      occurred_on: '2026-11-03',
      description: 'Conta de água',
    }),
    tx('padaria', {
      account_id: 'bb',
      payment_method: 'debit',
      amount_cents: 1300,
      occurred_on: '2026-11-03',
      description: 'Padaria',
    }),
  ];
}

describe('leitura do arquivo (RN-75)', () => {
  it('lê o OFX do BB em Windows-1252; recusa arquivo inválido e maior que 5 MB', () => {
    const ok = parseOfxBytes(BB);
    expect(ok.ok && ok.statements[0]?.transactions.length).toBe(4);
    expect(parseOfxBytes(new TextEncoder().encode('não é ofx'))).toEqual({
      ok: false,
      code: 'BAD_FILE',
    });
    expect(parseOfxBytes(new Uint8Array(5 * 1024 * 1024 + 1))).toEqual({
      ok: false,
      code: 'TOO_LARGE',
    });
  });
});

describe('E07: prévia, gravação e reimportação', () => {
  it('US-52: prévia com conciliação automática com um manual igual e sugestão para um parecido', async () => {
    const auth = fakeAuth();
    const db = dbOf(auth);
    await db.transactions.bulkPut(manuals());
    const { plan: p } = await plan(db, auth.user?.userId ?? '');
    expect(p.preview).toEqual({ total: 4, fresh: 2, merged: 1, suggested: 1, existing: 0 });
    const imported = p.transactions.filter((r) => r.import_id === p.importRow.id);
    expect(imported.map((r) => r.review_state).sort()).toEqual([
      'merged',
      'new',
      'new',
      'suggested',
    ]);
    expect(
      imported.every((r) => r.source === 'ofx' && r.external_id && r.account_id === 'bb'),
    ).toBe(true);
    expect(imported.find((r) => r.review_state === 'merged')?.duplicate_of).toBe('agua');
    expect(p.transactions.find((r) => r.id === 'agua')?.matched_external).toBe(true);
    expect(p.importRow).toMatchObject({
      source: 'ofx',
      status: 'committed',
      account_id: 'bb',
      stats: { total: 4, autoMerged: 1 },
    });
  });

  it('RN-78: grava tudo de uma vez; reimportar o mesmo arquivo avisa e não duplica nada', async () => {
    const auth = fakeAuth();
    const db = dbOf(auth);
    const userId = auth.user?.userId ?? '';
    await db.transactions.bulkPut(manuals());
    const first = await plan(db, userId);
    expect(await commitImport(db, first.plan, first.statement.acctIdMasked, NOW)).toEqual({
      ok: true,
      value: 4,
    });
    expect((await db.transactions.where('review_state').equals('new').toArray()).length).toBe(2);
    expect((await db.transactions.get('agua'))?.matched_external).toBe(true);
    const sha = await sha256Hex(BB);
    expect((await previousImport(db, sha))?.id).toBe(first.plan.importRow.id);
    const again = await plan(db, userId);
    expect(again.plan.preview).toEqual({
      total: 4,
      fresh: 0,
      merged: 0,
      suggested: 0,
      existing: 4,
    });
    await commitImport(db, again.plan, null, NOW);
    expect((await db.transactions.toArray()).filter((r) => r.source === 'ofx')).toHaveLength(4);
    // destino lembrado pela conta do arquivo
    expect(await rememberedDestination(db, first.statement.acctIdMasked)).toEqual({
      kind: 'account',
      id: 'bb',
    });
  });

  it('RN-78: desfazer em 24 h apaga o que a importação criou e solta os manuais; depois disso, não', async () => {
    const auth = fakeAuth();
    const db = dbOf(auth);
    const userId = auth.user?.userId ?? '';
    await db.transactions.bulkPut(manuals());
    const { plan: p, statement } = await plan(db, userId);
    await commitImport(db, p, statement.acctIdMasked, NOW);
    expect(undoable(await db.imports.toArray(), NOW + 1000)).toHaveLength(1);
    expect(undoable(await db.imports.toArray(), NOW + UNDO_WINDOW_MS + 1)).toHaveLength(0);
    expect(await undoImport(db, p.importRow.id, NOW + UNDO_WINDOW_MS + 1)).toEqual({
      ok: true,
      value: 0,
    });
    expect(await undoImport(db, p.importRow.id, NOW + 1000)).toEqual({ ok: true, value: 4 });
    const ofx = (await db.transactions.toArray()).filter((r) => r.source === 'ofx');
    expect(ofx.every((r) => r.deleted_at !== null)).toBe(true);
    expect((await db.transactions.get('agua'))?.matched_external).toBe(false);
    expect((await db.imports.get(p.importRow.id))?.status).toBe('reverted');
    // desfeita, o arquivo pode ser importado de novo
    expect(await previousImport(db, await sha256Hex(BB))).toBeNull();
  });

  it('cartão: compra vira despesa na fatura da RN-12 (criada se faltar) e crédito vira estorno', async () => {
    const auth = fakeAuth();
    const db = dbOf(auth);
    await db.cards.put(
      makeRow('cards', {
        id: 'nu',
        name: 'Nubank',
        closing_day: 3,
        due_day: 10,
        closing_day_rule: 'next',
        deleted_at: null,
      }),
    );
    const { plan: p } = await plan(db, auth.user?.userId ?? '', CARD_OFX, {
      kind: 'card',
      id: 'nu',
    });
    const rows = p.transactions;
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every(
        (r) =>
          r.card_id === 'nu' &&
          r.account_id === null &&
          r.invoice_id &&
          r.payment_method === 'credit',
      ),
    ).toBe(true);
    expect(new Set(rows.map((r) => r.kind))).toEqual(new Set(['expense', 'refund']));
    expect(p.invoices.length).toBeGreaterThan(0);
  });
});

describe('I03 (US-52)', () => {
  function fileOf(bytes: Uint8Array): File {
    const file = new File([bytes as Uint8Array<ArrayBuffer>], 'extrato.ofx');
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.resolve(bytes.slice().buffer),
    });
    return file;
  }

  function mount(auth: AuthValue) {
    const router = createMemoryRouter([{ path: '/', element: <ImportScreen /> }], {
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

  it('US-52: escolher o arquivo mostra a prévia; importar grava; o mesmo arquivo avisa "já foi importado"', async () => {
    const auth = fakeAuth();
    const db = dbOf(auth);
    await db.accounts.put(
      makeRow('accounts', { id: 'bb', name: 'BB', deleted_at: null, archived_at: null }),
    );
    await db.transactions.bulkPut(manuals());
    mount(auth);
    expect(
      await screen.findByText('O arquivo é lido no seu aparelho e não é enviado ao servidor.'),
    ).toBeDefined();
    fireEvent.change(screen.getByTestId('import-file'), { target: { files: [fileOf(BB)] } });
    expect((await screen.findByTestId('import-summary')).textContent).toBe(
      '4 lançamentos · 0 já existem (serão ignorados) · 1 parecidos com lançamentos seus (vão para conferência)',
    );
    expect(screen.getByTestId('import-merging').textContent).toBe(
      '1 serão conciliados com lançamentos seus',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Importar 4 lançamentos' }));
    expect(await screen.findByText('4 lançamentos importados.')).toBeDefined();
    await waitFor(async () => expect((await db.imports.toArray()).length).toBe(1));
    expect(await screen.findByTestId('import-recent')).toBeDefined();

    fireEvent.change(screen.getByTestId('import-file'), { target: { files: [fileOf(BB)] } });
    expect((await screen.findByTestId('import-already')).textContent).toMatch(
      /Este arquivo já foi importado em \d\d\/\d\d\./,
    );
    expect(screen.getByTestId('import-run').getAttribute('aria-disabled')).toBe('true');
  });

  it('RN-75 (T-085): o OFX real do BB anonimizado é lido; o de um mês sem movimento mostra "O arquivo não tem lançamentos."', async () => {
    const real = parseOfxBytes(REAL);
    expect(real.ok && real.statements[0]?.transactions.map((x) => x.amountCents)).toEqual([
      -15000, -3790,
    ]);
    expect(parseOfxBytes(REAL_EMPTY)).toEqual({ ok: false, code: 'EMPTY' });
    const auth = fakeAuth();
    mount(auth);
    fireEvent.change(await screen.findByTestId('import-file'), {
      target: { files: [fileOf(REAL_EMPTY)] },
    });
    expect((await screen.findByTestId('import-error')).textContent).toBe(
      'O arquivo não tem lançamentos.',
    );
    expect(screen.queryByTestId('import-preview')).toBeNull();
  });

  it('arquivo inválido mostra "Arquivo não reconhecido…"', async () => {
    const auth = fakeAuth();
    mount(auth);
    fireEvent.change(await screen.findByTestId('import-file'), {
      target: { files: [fileOf(new TextEncoder().encode('planilha qualquer'))] },
    });
    expect((await screen.findByTestId('import-error')).textContent).toBe(
      'Arquivo não reconhecido. Envie um OFX ou CSV exportado pelo banco.',
    );
  });
});
