// T-070: backup completo e restauração (US-60; RN-102: as linhas restauradas ficam com o dono da sessão).
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { OakDb, SyncedTable } from '../src/data/db';
import { deleteRow, saveRow } from '../src/data/repositories/rows';
import {
  BACKUP_EXCLUDED,
  BACKUP_SCHEMA_VERSION,
  BACKUP_TABLES,
  BackupError,
  type BackupFile,
  backupFileName,
  buildBackup,
  exportBackup,
  parseBackup,
  restoreBackup,
} from '../src/features/settings/backup';
import { DataScreen, restoreSummaryText } from '../src/features/settings/DataScreen';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

const here = dirname(fileURLToPath(import.meta.url));
const NOW = Date.parse('2026-11-08T01:30:00.000Z'); // 07/11 22:30 em São Paulo

function dbOf(auth: AuthValue): OakDb {
  const db = auth.user?.db;
  if (!db) {
    throw new Error('sem sessão');
  }
  return db;
}

async function seed(auth: AuthValue): Promise<void> {
  const db = dbOf(auth);
  const userId = auth.user?.userId ?? '';
  await db.profiles.put(
    makeRow('profiles', {
      id: userId,
      user_id: userId,
      display_name: null,
      timezone: 'America/Sao_Paulo',
      settings: { theme: 'dark' },
      onboarding: { done: ['income'] },
      deleted_at: null,
    }),
  );
  await db.accounts.bulkPut([
    makeRow('accounts', { id: 'acc-1', user_id: userId, name: 'Conta', deleted_at: null }),
    makeRow('accounts', {
      id: 'acc-velha',
      user_id: userId,
      name: 'Antiga',
      deleted_at: '2026-10-01T00:00:00.000Z',
    }),
  ]);
  await db.cards.put(
    makeRow('cards', { id: 'card-1', user_id: userId, name: 'Cartão', deleted_at: null }),
  );
  await db.categories.put(
    makeRow('categories', {
      id: 'cat-1',
      user_id: userId,
      name: 'Mercado',
      bucket: 'needs',
      kind: 'expense',
      deleted_at: null,
    }),
  );
  await db.budgets.put(makeRow('budgets', { id: 'bud-1', user_id: userId, deleted_at: null }));
  await db.notices.put(makeRow('notices', { id: 'not-1', user_id: userId, deleted_at: null }));
  await db.transactions.bulkPut([
    tx('tx-1', { user_id: userId, description: 'PADARIA; "SOL"', amount_cents: 1234 }),
    tx('tx-2', { user_id: userId, kind: 'income', amount_cents: 500000 }),
  ]);
  await db.bank_connections.put(
    makeRow('bank_connections', { id: 'conn-1', user_id: userId, deleted_at: null }),
  );
  await db.external_accounts.put(
    makeRow('external_accounts', { id: 'ext-1', user_id: userId, deleted_at: null }),
  );
}

/** Conteúdo comparável: sem as marcas de quem gravou e quando (relógio híbrido, aparelho, data do arquivo). */
function normalized(file: BackupFile): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const [table, rows] of Object.entries(file.tables)) {
    out[table] = (rows ?? []).map(({ client_updated_at, device_id, ...rest }) => rest);
  }
  return out;
}

function textFile(content: string, name = 'backup.json'): File {
  const file = new File([content], name, { type: 'application/json' });
  // jsdom antigo não tem `File.text()`: o teste não depende disso.
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
  return file;
}

function renderScreen(auth: AuthValue, download = vi.fn()) {
  const router = createMemoryRouter(
    [{ path: '/', element: <DataScreen today="2026-11-07" download={download} /> }],
    { initialEntries: ['/'] },
  );
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
  return download;
}

describe('backup (US-60)', () => {
  it('US-60: o nome é backup_AAAA-MM-DD.json com a data de São Paulo', async () => {
    expect(backupFileName('2026-11-07')).toBe('backup_2026-11-07.json');
    const auth = fakeAuth();
    const file = await exportBackup(dbOf(auth), NOW);
    expect(file.name).toBe('backup_2026-11-07.json');
    expect(JSON.parse(file.content).exported_at).toBe('2026-11-08T01:30:00.000Z');
  });

  it('US-60: a versão do esquema é a da última migração', () => {
    const migrations = readdirSync(join(here, '../../../supabase/migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(migrations.at(-1)?.slice(0, 14)).toBe(BACKUP_SCHEMA_VERSION);
  });

  it('US-60: gerar backup traz versão do esquema e todas as tabelas, sem segredos de integração nem push', async () => {
    const auth = fakeAuth();
    await seed(auth);
    const file = await buildBackup(dbOf(auth), NOW);
    expect(file.format).toBe('oakfinance-backup');
    expect(file.schema_version).toBe(BACKUP_SCHEMA_VERSION);
    expect(Object.keys(file.tables).sort()).toEqual([...BACKUP_TABLES].sort());
    expect(BACKUP_EXCLUDED).toEqual(['bank_connections', 'external_accounts']);
    const text = JSON.stringify(file);
    expect(text).not.toContain('conn-1');
    expect(text).not.toContain('ext-1');
    expect(text).not.toContain('push_subscriptions');
    expect(text).not.toContain('user_id');
    expect(text).not.toContain('_pending');
    expect(file.tables.transactions?.map((row) => row.id)).toEqual(['tx-1', 'tx-2']);
    expect(file.tables.accounts?.map((row) => row.id)).toEqual(['acc-1', 'acc-velha']);
  });

  it('US-60: o ciclo exportar → apagar → restaurar é idêntico', async () => {
    const auth = fakeAuth();
    const db = dbOf(auth);
    await seed(auth);
    const before = await buildBackup(db, NOW);
    const text = `${JSON.stringify(before)}\n`;

    // Apagar: exclui tudo, altera o perfil e cria uma linha que não está no backup.
    for (const table of BACKUP_TABLES) {
      for (const row of await db.table(table).toArray()) {
        await deleteRow(db, table as SyncedTable, row.id, { nowMs: NOW });
      }
    }
    await saveRow(db, 'transactions', tx('tx-nova', { user_id: auth.user?.userId ?? '' }));

    const result = await restoreBackup(db, parseBackup(text, auth.user?.userId ?? ''), {
      nowMs: NOW + 1000,
    });
    expect(result.ok).toBe(true);
    const after = await buildBackup(db, NOW);
    const extra = after.tables.transactions?.find((row) => row.id === 'tx-nova');
    expect(extra?.deleted_at).toBe('2026-11-08T01:30:01.000Z');
    after.tables.transactions = (after.tables.transactions ?? []).filter(
      (row) => row.id !== 'tx-nova',
    );
    expect(normalized(after)).toEqual(normalized(before));
    // As integrações não são tocadas.
    expect(await db.bank_connections.get('conn-1')).toBeDefined();
  });

  it('US-60 / RN-102: a restauração reescreve o user_id para o de quem restaura e põe tudo na outbox', async () => {
    const origin = fakeAuth();
    await seed(origin);
    const { content } = await exportBackup(dbOf(origin), NOW);
    const target = fakeAuth();
    const db = dbOf(target);
    const userId = target.user?.userId ?? '';
    const result = await restoreBackup(db, parseBackup(content, userId), { nowMs: NOW });
    expect(result.ok && result.value).toMatchObject({ transactions: 2, accounts: 1, cards: 1 });
    const profile = await db.profiles.toArray();
    expect(profile.map((p) => [p.id, p.user_id])).toEqual([[userId, userId]]);
    expect(profile[0]?.settings).toEqual({ theme: 'dark' });
    for (const table of BACKUP_TABLES) {
      for (const row of await db.table(table).toArray()) {
        expect(row.user_id, table).toBe(userId);
        expect(row._pending, table).toBe(1);
      }
    }
    const outbox = await db.outbox.toArray();
    expect(outbox).toHaveLength(9);
    expect(outbox.every((entry) => entry.row.user_id === userId)).toBe(true);
  });

  it('US-60: resumo do que foi restaurado', () => {
    expect(
      restoreSummaryText({
        transactions: 120,
        accounts: 3,
        cards: 1,
        categories: 21,
        profiles: 1,
        budgets: 4,
        notices: 2,
      }),
    ).toBe('Restaurado: 120 lançamentos, 3 contas, 1 cartões, 21 categorias e 6 outros itens.');
  });

  it('US-60: backup inválido ou de versão incompatível é recusado', async () => {
    const auth = fakeAuth();
    await seed(auth);
    const good = await buildBackup(dbOf(auth), NOW);
    const variants: string[] = [
      'não é json',
      '[]',
      JSON.stringify({ ...good, format: 'outro-app' }),
      JSON.stringify({ ...good, schema_version: '29991231000000' }),
      JSON.stringify({ ...good, schema_version: 3 }),
      JSON.stringify({ ...good, exported_at: 'ontem' }),
      JSON.stringify({ ...good, tables: { ...good.tables, bank_connections: [] } }),
      JSON.stringify({ ...good, tables: { ...good.tables, push_subscriptions: [] } }),
      JSON.stringify({ ...good, tables: { ...good.tables, accounts: {} } }),
      JSON.stringify({ ...good, tables: { ...good.tables, accounts: [{ id: 'acc-1' }] } }),
      JSON.stringify({
        ...good,
        tables: {
          ...good.tables,
          transactions: [good.tables.transactions?.[0], good.tables.transactions?.[0]],
        },
      }),
      JSON.stringify({
        ...good,
        tables: {
          ...good.tables,
          profiles: [good.tables.profiles?.[0], good.tables.profiles?.[0]],
        },
      }),
    ];
    for (const text of variants) {
      expect(() => parseBackup(text, 'u'), text.slice(0, 60)).toThrow(BackupError);
    }
    // Versão mais antiga com as colunas de hoje é aceita; BOM no início também.
    const older = JSON.stringify({ ...good, schema_version: '20261105000001' });
    expect(parseBackup(`﻿${older}`, 'u').tables.get('transactions')).toHaveLength(2);
  });
});

describe('S10 — Baixar e restaurar backup (US-60)', () => {
  it('US-60: Baixar backup gera o JSON com o nome do dia', async () => {
    const auth = fakeAuth();
    await seed(auth);
    const download = renderScreen(auth);
    fireEvent.click(await screen.findByRole('button', { name: 'Baixar backup' }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const [name, content, type] = download.mock.calls[0] as [string, string, string];
    expect(name).toMatch(/^backup_\d{4}-\d{2}-\d{2}\.json$/);
    expect(type).toBe('application/json;charset=utf-8');
    expect(JSON.parse(content).tables.transactions).toHaveLength(2);
    expect(await screen.findByText('Backup gerado.')).toBeDefined();
  });

  it('US-60: Restaurar pede RESTAURAR, substitui os dados e mostra o resumo', async () => {
    const origin = fakeAuth();
    await seed(origin);
    const { content } = await exportBackup(dbOf(origin), NOW);
    const auth = fakeAuth();
    const db = dbOf(auth);
    await db.transactions.put(tx('tx-local', { user_id: auth.user?.userId ?? '' }));
    renderScreen(auth);

    fireEvent.change(await screen.findByTestId('restore-file'), {
      target: { files: [textFile(content)] },
    });
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('backup de 07/11/2026');
    const run = await screen.findByRole('button', { name: 'Substituir todos os meus dados' });
    expect(run.getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(screen.getByLabelText('Digite RESTAURAR para confirmar'), {
      target: { value: 'restaura' },
    });
    expect(run.getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(screen.getByLabelText('Digite RESTAURAR para confirmar'), {
      target: { value: 'RESTAURAR' },
    });
    expect(run.hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(run);

    expect((await screen.findByTestId('restore-summary')).textContent).toBe(
      'Restaurado: 2 lançamentos, 1 contas, 1 cartões, 1 categorias e 2 outros itens.',
    );
    expect((await db.transactions.get('tx-local'))?.deleted_at).not.toBeNull();
    expect((await db.transactions.get('tx-1'))?.deleted_at).toBeNull();
  });

  it('US-60: arquivo inválido mostra a mensagem e nada muda', async () => {
    const auth = fakeAuth();
    const db = dbOf(auth);
    await db.transactions.put(tx('tx-local', { user_id: auth.user?.userId ?? '' }));
    renderScreen(auth);
    fireEvent.change(await screen.findByTestId('restore-file'), {
      target: { files: [textFile('{"format":"oakfinance-backup","schema_version":"1"}')] },
    });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Este arquivo não é um backup válido deste app',
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect((await db.transactions.get('tx-local'))?.deleted_at).toBeNull();
    expect(await db.outbox.count()).toBe(0);
  });
});
