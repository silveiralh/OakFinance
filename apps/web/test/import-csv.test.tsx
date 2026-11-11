// T-086: importar CSV (US-53; RN-65, RN-76, RN-78) com os presets provisórios do Nubank e o assistente de colunas.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSV_PRESETS, type CsvProfile, mapCsvRows } from '@oakfinance/domain';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
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
import { inWorkerForTests, looksLikeOfx } from '../src/features/imports/parse-file';
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

describe('I03: segundo arquivo logo depois de importar (E08)', () => {
  const GENERIC =
    'Dt;Hist;Vlr\n03/11/2026;MERCADO EXEMPLO;-45,90\n04/11/2026;SALARIO EXEMPLO;3000,00\n';
  const csvFile = (text: string, name: string) => {
    const bytes = new TextEncoder().encode(text);
    const file = new File([bytes], name);
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.resolve(bytes.slice().buffer),
    });
    return file;
  };

  it('US-53: o arquivo escolhido enquanto a importação anterior termina mantém a prévia e usa o mapeamento salvo', async () => {
    const auth = fakeAuth();
    const db = dbOf(auth);
    await db.accounts.put(
      makeRow('accounts', { id: 'bb', name: 'Banco E08', deleted_at: null, archived_at: null }),
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
    fireEvent.change(await screen.findByTestId('import-file'), {
      target: { files: [csvFile(GENERIC, 'banco-a.csv')] },
    });
    expect((await screen.findByTestId('import-summary')).textContent).toContain('2 lançamentos');
    fireEvent.click(screen.getByRole('button', { name: 'Importar 2 lançamentos' }));
    // como no E08: o próximo arquivo entra assim que "Importações recentes" aparece
    await screen.findByTestId('import-recent');
    fireEvent.change(screen.getByTestId('import-file'), {
      target: { files: [csvFile(`${GENERIC}05/11/2026;PADARIA EXEMPLO;-7,00\n`, 'banco-b.csv')] },
    });
    expect((await screen.findByTestId('csv-detected')).textContent).toBe(
      'Formato detectado: Outro banco',
    );
    await waitFor(() =>
      expect(screen.getByTestId('import-summary').textContent).toBe(
        '3 lançamentos · 2 já existem (serão ignorados) · 0 parecidos com lançamentos seus (vão para conferência)',
      ),
    );
    // a prévia continua depois de a importação anterior terminar
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId('import-summary')).toBeDefined();
  });
});

describe('I03: nenhum caminho sem retorno visível (issue #128)', () => {
  function renderImport() {
    const auth = fakeAuth();
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
    return auth;
  }

  it('US-53: arquivo que não pode ser lido mostra o erro da I03 em vez de falhar em silêncio', async () => {
    const auth = renderImport();
    await dbOf(auth).accounts.put(
      makeRow('accounts', { id: 'nu', name: 'Nubank conta', deleted_at: null, archived_at: null }),
    );
    const file = new File(['x'], 'extrato.csv');
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.reject(new DOMException('arquivo ilegível', 'NotReadableError')),
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fireEvent.change(await screen.findByTestId('import-file'), { target: { files: [file] } });
    expect((await screen.findByTestId('import-error')).textContent).toBe(
      'Arquivo não reconhecido. Envie um OFX ou CSV exportado pelo banco.',
    );
    expect(screen.queryByTestId('import-preview')).toBeNull();
    spy.mockRestore();
  });

  it('US-53: CSV binário (ilegível) mostra o erro na tela', async () => {
    renderImport();
    const bytes = new Uint8Array([0x44, 0x61, 0x00, 0x74, 0x61, 0x0a, 0x00]);
    const file = new File([bytes], 'extrato.csv');
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.resolve(bytes.slice().buffer),
    });
    fireEvent.change(await screen.findByTestId('import-file'), { target: { files: [file] } });
    expect((await screen.findByTestId('import-error')).textContent).toBe(
      'Arquivo não reconhecido. Envie um OFX ou CSV exportado pelo banco.',
    );
  });
});

describe('Worker da leitura (issue #128)', () => {
  const CSV = new TextEncoder().encode('Data,Valor\n01/11/2026,-1.00\n');
  const local = () => ({ ok: true as const, via: 'thread' });

  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: { preventDefault(): void }) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminated = false;
    constructor(private readonly behavior: 'error' | 'silent' | 'malformed' | 'ok') {}
    postMessage() {
      queueMicrotask(() => {
        if (this.behavior === 'error') {
          this.onerror?.({ preventDefault: () => undefined });
        } else if (this.behavior === 'malformed') {
          this.onmessage?.({ data: 'lixo' } as MessageEvent);
        } else if (this.behavior === 'ok') {
          this.onmessage?.({ data: { ok: true, via: 'worker' } } as MessageEvent);
        }
      });
    }
    terminate() {
      this.terminated = true;
    }
  }

  it('US-53: erro no script, resposta fora do formato, Worker que não cria ou que não responde → leitura na thread', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    try {
      const make = (b: ConstructorParameters<typeof FakeWorker>[0]) => () =>
        new FakeWorker(b) as unknown as Worker;
      expect(await inWorkerForTests(make('ok'), CSV, local)).toEqual({ ok: true, via: 'worker' });
      expect(await inWorkerForTests(make('error'), CSV, local)).toEqual(local());
      expect(await inWorkerForTests(make('malformed'), CSV, local)).toEqual(local());
      const failing = () => {
        throw new DOMException('bloqueado', 'SecurityError');
      };
      expect(await inWorkerForTests(failing, CSV, local)).toEqual(local());
      const silent = new FakeWorker('silent');
      expect(await inWorkerForTests(() => silent as unknown as Worker, CSV, local, 10)).toEqual(
        local(),
      );
      expect(silent.terminated).toBe(true);
      // erro também na thread: a promessa rejeita (a tela mostra o aviso)
      await expect(
        inWorkerForTests(make('error'), CSV, () => {
          throw new Error('quebrou');
        }),
      ).rejects.toThrow('quebrou');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
