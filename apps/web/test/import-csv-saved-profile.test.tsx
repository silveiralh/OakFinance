// Issue #152 (regressão do #138): o cartão com um perfil CSV salvo antes da correção do preset da fatura do Nubank
// (`decimal: '.'`) nunca usava o preset novo, e nada era lido. Agora o perfil salvo só vale se ler o arquivo, e
// uma importação sem lançamentos não grava o perfil.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSV_PRESETS, type CsvProfile, mapCsvRows } from '@oakfinance/domain';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { OakDb } from '../src/data/db';
import { decodeCsvBytes, tokenizeCsv } from '../src/features/imports/csv-parse';
import {
  initialProfile,
  profileIdFor,
  readableCount,
  rememberCsvProfile,
  savedProfiles,
} from '../src/features/imports/csv-profile';
import { ImportScreen } from '../src/features/imports/screens';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow } from './data/rows';

const here = dirname(fileURLToPath(import.meta.url));
const FATURA_REAL = new Uint8Array(
  readFileSync(join(here, '../../../packages/domain/test/fixtures', 'nubank-fatura-real-anon.csv')),
);
const PRESET = CSV_PRESETS.find((p) => p.id === 'nubank-fatura') as CsvProfile;
const CARD = { kind: 'card' as const, id: 'nu' };
/** O perfil que a tentativa da issue #128 deixou gravado para o cartão: o preset provisório, com ponto decimal. */
const OLD: CsvProfile = { ...PRESET, decimal: '.', id: profileIdFor(CARD), target: 'card' };

function textOf(bytes: Uint8Array): string {
  const decoded = decodeCsvBytes(bytes);
  if (!decoded.ok) {
    throw new Error(decoded.code);
  }
  return decoded.text;
}

function dbOf(auth: AuthValue): OakDb {
  const db = auth.user?.db;
  if (!db) {
    throw new Error('sem sessão');
  }
  return db;
}

function fileOf(bytes: Uint8Array, name: string): File {
  const file = new File([bytes as Uint8Array<ArrayBuffer>], name);
  Object.defineProperty(file, 'arrayBuffer', {
    value: () => Promise.resolve(bytes.slice().buffer),
  });
  return file;
}

async function seed(auth: AuthValue, withAccount: boolean) {
  const db = dbOf(auth);
  if (withAccount) {
    await db.accounts.put(
      makeRow('accounts', { id: 'bb', name: 'Conta BB', deleted_at: null, archived_at: null }),
    );
  }
  await db.cards.put(
    makeRow('cards', {
      id: 'nu',
      name: 'Nubank',
      closing_day: 3,
      due_day: 10,
      closing_day_rule: 'next',
      limit_cents: null,
      payment_account_id: null,
      deleted_at: null,
      archived_at: null,
      sort_order: 0,
    }),
  );
  await db.profiles.put(
    makeRow('profiles', {
      id: auth.user?.userId ?? '',
      settings: { csvProfiles: [OLD] } as never,
      deleted_at: null,
    }),
  );
  return db;
}

function renderImport(auth: AuthValue) {
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

describe('issue #152: perfil CSV salvo que não lê o arquivo', () => {
  const text = textOf(FATURA_REAL);
  const tokenized = tokenizeCsv(text);
  const all = mapCsvRows(tokenized.rows, PRESET).rows.length;

  it('US-53 (RN-76): com o perfil antigo salvo para o cartão, a fatura real usa o preset detectado e lê todas as linhas', () => {
    expect(all).toBeGreaterThan(0);
    expect(readableCount(text, OLD, tokenized)).toBe(0);
    const { profile, detected } = initialProfile(
      tokenized.rows[0] ?? [],
      [OLD],
      CARD,
      tokenized.delimiter,
      (p) => readableCount(text, p, tokenized),
    );
    expect(detected).toBe('Nubank — fatura');
    expect(profile.decimal).toBe(',');
    expect(mapCsvRows(tokenized.rows, profile)).toMatchObject({ errors: [] });
    expect(mapCsvRows(tokenized.rows, profile).rows).toHaveLength(all);
  });

  it('US-53 (RN-76): o perfil salvo que lê o arquivo continua valendo, mesmo com cabeçalho de preset', () => {
    const mine: CsvProfile = { ...PRESET, name: 'Minha fatura', id: profileIdFor(CARD) };
    const { profile, detected } = initialProfile(
      tokenized.rows[0] ?? [],
      [mine],
      CARD,
      tokenized.delimiter,
      (p) => readableCount(text, p, tokenized),
    );
    expect(profile.name).toBe('Minha fatura');
    expect(detected).toBe('Minha fatura');
  });

  it('US-53: importação que não gerou nenhum lançamento não grava o perfil; com lançamentos, grava', async () => {
    const auth = fakeAuth();
    const db = dbOf(auth);
    await db.profiles.put(
      makeRow('profiles', { id: auth.user?.userId ?? '', settings: {}, deleted_at: null }),
    );
    expect(await rememberCsvProfile(db, OLD, CARD, 0)).toBe(false);
    expect(savedProfiles((await db.profiles.toCollection().first())?.settings)).toEqual([]);
    expect(await rememberCsvProfile(db, PRESET, CARD, 3)).toBe(true);
    expect(
      savedProfiles((await db.profiles.toCollection().first())?.settings).map((p) => [
        p.id,
        p.decimal,
      ]),
    ).toEqual([[profileIdFor(CARD), ',']]);
  });

  it('US-53: na I03, a fatura real com o perfil antigo do cartão mostra todas as linhas e importa os lançamentos', async () => {
    const auth = fakeAuth();
    const db = await seed(auth, false);
    renderImport(auth);
    fireEvent.change(await screen.findByTestId('import-file'), {
      target: { files: [fileOf(FATURA_REAL, 'fatura.csv')] },
    });
    expect((await screen.findByTestId('csv-detected')).textContent).toBe(
      'Formato detectado: Nubank — fatura',
    );
    expect(screen.queryByTestId('csv-errors')).toBeNull();
    const run = await screen.findByRole('button', { name: `Importar ${all} lançamentos` });
    fireEvent.click(run);
    expect(await screen.findByText(`${all} lançamentos importados.`)).toBeDefined();
    await waitFor(async () =>
      expect(
        savedProfiles((await db.profiles.toCollection().first())?.settings).map((p) => [
          p.id,
          p.decimal,
        ]),
      ).toEqual([[profileIdFor(CARD), ',']]),
    );
    const imported = (await db.transactions.toArray()).filter((r) => r.source === 'csv');
    expect(imported).toHaveLength(all);
  });

  it('US-53: escolher o cartão em "Importar para" com o perfil antigo mantém o preset e a prévia completa', async () => {
    const auth = fakeAuth();
    await seed(auth, true);
    renderImport(auth);
    fireEvent.change(await screen.findByTestId('import-file'), {
      target: { files: [fileOf(FATURA_REAL, 'fatura.csv')] },
    });
    const select = (await screen.findByLabelText('Importar para')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'account:bb' } });
    fireEvent.change(select, { target: { value: 'card:nu' } });
    expect((await screen.findByTestId('csv-detected')).textContent).toBe(
      'Formato detectado: Nubank — fatura',
    );
    expect(screen.queryByTestId('csv-errors')).toBeNull();
    expect(
      await screen.findByRole('button', { name: `Importar ${all} lançamentos` }),
    ).toBeDefined();
  });
});
