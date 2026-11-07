// T-086: importar CSV (US-53; RN-65, RN-76, RN-78) com os presets provisórios do Nubank e o assistente de colunas.
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
  saveCsvProfile,
  savedProfiles,
} from '../src/features/imports/csv-profile';
import { planImport, sha256Hex } from '../src/features/imports/ofx-import';
import { looksLikeOfx } from '../src/features/imports/parse-file';
import { ImportScreen } from '../src/features/imports/screens';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow } from './data/rows';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(here, '../../../packages/domain/test/fixtures', name)));
const CONTA = fixture('nubank-conta.csv');
const FATURA = fixture('nubank-fatura.csv');

function dbOf(auth: AuthValue): OakDb {
  const db = auth.user?.db;
  if (!db) {
    throw new Error('sem sessão');
  }
  return db;
}

function rowsOf(bytes: Uint8Array) {
  const decoded = decodeCsvBytes(bytes);
  if (!decoded.ok) {
    throw new Error(decoded.code);
  }
  return tokenizeCsv(decoded.text);
}

describe('leitura do CSV (RN-76)', () => {
  it('UTF-8 com BOM, Windows-1252 e separador detectado; OFX reconhecido pelo conteúdo', () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('a;b\n1;2\n')]);
    const decoded = decodeCsvBytes(bom);
    expect(decoded.ok && decoded.text.startsWith('a;b')).toBe(true);
    expect(tokenizeCsv('a;b\n1;2').delimiter).toBe(';');
    const latin = new Uint8Array([0x44, 0x65, 0x73, 0x63, 0x72, 0x69, 0xe7, 0xe3, 0x6f]); // "Descrição" em 1252
    const l = decodeCsvBytes(latin);
    expect(l.ok && l.encoding).toBe('windows-1252');
    expect(l.ok && l.text).toBe('Descrição');
    expect(decodeCsvBytes(new Uint8Array())).toEqual({ ok: false, code: 'EMPTY' });
    expect(looksLikeOfx('extrato.txt', new TextEncoder().encode('OFXHEADER:100'))).toBe(true);
    expect(looksLikeOfx('extrato.csv', CONTA)).toBe(false);
  });
});

describe('US-53: presets e mapeamento', () => {
  it('US-53: "date,title,amount" sugere "Nubank — fatura" e positivos entram como compras no cartão', async () => {
    const { rows } = rowsOf(FATURA);
    const { profile, detected } = initialProfile(rows[0] ?? [], [], null, ',');
    expect(detected).toBe('Nubank — fatura');
    expect(profile.target).toBe('card');
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
    const mapped = mapCsvRows(rows, profile);
    const plan = planImport({
      userId: auth.user?.userId ?? '',
      csv: { rows: mapped.rows, profileId: profile.id },
      destination: { kind: 'card', id: 'nu' },
      fileName: 'fatura.csv',
      sha: await sha256Hex(FATURA),
      txs: [],
      invoices: [],
      cards: await db.cards.toArray(),
      recurrences: [],
      nowMs: Date.parse('2026-11-06T12:00:00Z'),
    });
    const created = plan.transactions;
    expect(created.map((r) => [r.kind, r.amount_cents, r.card_id, r.source])).toEqual([
      ['expense', 1250, 'nu', 'csv'],
      ['expense', 10000, 'nu', 'csv'],
      ['expense', 10000, 'nu', 'csv'],
      ['refund', 98000, 'nu', 'csv'],
    ]);
    // RN-65: as duas linhas idênticas no mesmo dia têm chaves diferentes (ordinal)
    expect(new Set(created.map((r) => r.external_id)).size).toBe(4);
    expect(plan.importRow).toMatchObject({
      source: 'csv',
      csv_profile: 'nubank-fatura',
      period_start: '2026-11-03',
      period_end: '2026-11-05',
    });
  });

  it('US-53: "Data,Valor,Identificador,Descrição" sugere "Nubank — conta"; negativo é saída e o Identificador vira a chave', () => {
    const { rows } = rowsOf(CONTA);
    const { profile, detected } = initialProfile(
      rows[0] ?? [],
      [],
      { kind: 'account', id: 'bb' },
      ',',
    );
    expect(detected).toBe('Nubank — conta');
    const mapped = mapCsvRows(rows, profile);
    expect(mapped.rows.map((r) => [r.kind, r.amountCents, r.extra.externalId])).toEqual([
      ['expense', 8790, 'id-ficticio-0001'],
      ['income', 150000, 'id-ficticio-0002'],
    ]);
    expect(mapped.errors.map((e) => e.code)).toEqual(['CSV_DATE_INVALID', 'CSV_AMOUNT_INVALID']);
  });

  it('US-53: CSV desconhecido começa pelo genérico; o mapeamento confirmado fica salvo para a conta', async () => {
    const text = 'Dt;Hist;Vlr\n03/11/2026;MERCADO EXEMPLO;-45,90\n04/11/2026;SALARIO;3000,00\n';
    const { rows, delimiter } = tokenizeCsv(text);
    const dest = { kind: 'account' as const, id: 'bb' };
    const first = initialProfile(rows[0] ?? [], [], dest, delimiter);
    expect(first.detected).toBeNull();
    expect(first.profile).toMatchObject({
      delimiter: ';',
      columns: { date: 'Dt', description: 'Hist', amount: 'Vlr' },
      decimal: ',',
    });
    expect(mapCsvRows(rows, first.profile).rows.map((r) => r.amountCents)).toEqual([4590, 300000]);
    const auth = fakeAuth();
    const db = dbOf(auth);
    await db.profiles.put(
      makeRow('profiles', {
        id: auth.user?.userId ?? '',
        settings: { theme: 'dark' },
        deleted_at: null,
      }),
    );
    const mine: CsvProfile = { ...first.profile, dateFormat: 'DD/MM/YYYY', name: 'Meu banco' };
    await saveCsvProfile(db, mine, dest);
    const settings = (await db.profiles.toCollection().first())?.settings;
    expect(settings).toMatchObject({ theme: 'dark' });
    const saved = savedProfiles(settings);
    expect(saved.map((p) => p.id)).toEqual([profileIdFor(dest)]);
    expect(initialProfile(rows[0] ?? [], saved, dest, ',').profile.name).toBe('Meu banco');
    // outro destino não herda
    expect(
      initialProfile(rows[0] ?? [], saved, { kind: 'card', id: 'nu' }, ',').detected,
    ).toBeNull();
    expect(CSV_PRESETS.length).toBe(3);
  });
});

describe('I03 com CSV (US-53)', () => {
  it('US-53: escolher o CSV do Nubank mostra o formato detectado, as 5 primeiras linhas e importa', async () => {
    const auth = fakeAuth();
    const db = dbOf(auth);
    await db.accounts.put(
      makeRow('accounts', { id: 'bb', name: 'Nubank conta', deleted_at: null, archived_at: null }),
    );
    await db.profiles.put(
      makeRow('profiles', { id: auth.user?.userId ?? '', settings: {}, deleted_at: null }),
    );
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
    const file = new File([CONTA as Uint8Array<ArrayBuffer>], 'nubank.csv');
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.resolve(CONTA.slice().buffer),
    });
    fireEvent.change(await screen.findByTestId('import-file'), { target: { files: [file] } });
    expect((await screen.findByTestId('csv-detected')).textContent).toBe(
      'Formato detectado: Nubank — conta',
    );
    expect(screen.getByTestId('csv-preview').querySelectorAll('tr')).toHaveLength(2);
    expect(screen.getByTestId('csv-errors').textContent).toBe('2 linhas com erro ficam de fora.');
    expect((await screen.findByTestId('import-summary')).textContent).toBe(
      '2 lançamentos · 0 já existem (serão ignorados) · 0 parecidos com lançamentos seus (vão para conferência)',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Importar 2 lançamentos' }));
    expect(await screen.findByText('2 lançamentos importados.')).toBeDefined();
    await waitFor(async () =>
      expect(
        savedProfiles((await db.profiles.toCollection().first())?.settings).map((p) => p.id),
      ).toEqual(['dest-account-bb']),
    );
    const imported = (await db.transactions.toArray()).filter((r) => r.source === 'csv');
    expect(imported).toHaveLength(2);
  });
});
