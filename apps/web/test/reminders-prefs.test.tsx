// T-093: preferências de notificação na S07 (US-44; RN-86, RN-87, RN-93): liga e desliga cada tipo, horário do
// diário, dia e hora do resumo e a janela de silêncio; tudo grava nas linhas sincronizadas que o tick lê.
import { DEFAULT_REMINDERS, seedReminderId } from '@oakfinance/domain';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { OakDb } from '../src/data/db';
import { ensureSeeds } from '../src/data/seeds';
import { ReminderPrefs } from '../src/features/settings/ReminderPrefs';
import {
  groupEnabled,
  hhmm,
  PREF_GROUPS,
  quietHoursOf,
  setGroupEnabled,
  setQuietHours,
  setSchedule,
} from '../src/features/settings/reminder-prefs';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow } from './data/rows';

// Os cenários deste arquivo cobrem o app com o Open Finance ligado (build E2E e v2); sem ele, ver
// test/open-finance-off.test.tsx (T-115, D-080).
vi.mock('../src/app/openFinance', () => ({ OPEN_FINANCE_ENABLED: true }));

function dbOf(auth: AuthValue): OakDb {
  const db = auth.user?.db;
  if (!db) {
    throw new Error('sem sessão');
  }
  return db;
}

async function seeded() {
  const auth = fakeAuth();
  await ensureSeeds(dbOf(auth), auth.user?.userId ?? '');
  return auth;
}

function mount(auth: AuthValue) {
  const router = createMemoryRouter([{ path: '*', element: <ReminderPrefs /> }]);
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
}

const kindRow = async (db: OakDb, kind: string) =>
  (await db.reminders.toArray()).find((r) => r.kind === kind && r.deleted_at === null);

describe('US-44: preferências de notificação', () => {
  it('US-44: a S07 lista cada tipo (diário, faturas, contas fixas, receitas, limites, resumo, conexão) ligado por padrão', async () => {
    const auth = await seeded();
    mount(auth);
    const card = await screen.findByTestId('reminder-prefs');
    for (const label of [
      'Vencimento de faturas',
      'Fatura fechou',
      'Contas fixas',
      'Conta fixa atrasada e receita não confirmada',
      'Limite de faixa ou categoria',
      'Lembrete diário',
      'Resumo semanal',
      'Conexão bancária',
    ]) {
      expect(within(card).getByRole('switch', { name: label })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    }
    // todos os tipos do domínio estão em algum grupo
    const grouped = PREF_GROUPS.flatMap((g) => [...g.kinds]).sort();
    expect(grouped).toEqual(DEFAULT_REMINDERS.map((r) => r.kind).sort());
  });

  it('US-44: desligar "Conta fixa atrasada e receita não confirmada" desliga os dois tipos e vale no próximo tick', async () => {
    const auth = await seeded();
    const db = dbOf(auth);
    mount(auth);
    fireEvent.click(
      await screen.findByRole('switch', { name: 'Conta fixa atrasada e receita não confirmada' }),
    );
    await waitFor(async () => expect((await kindRow(db, 'bill_overdue'))?.enabled).toBe(false));
    expect((await kindRow(db, 'income_unconfirmed'))?.enabled).toBe(false);
    expect((await kindRow(db, 'bill_due'))?.enabled).toBe(true);
    // a mudança entra na outbox (sincroniza e o servidor lê no tick seguinte)
    expect((await kindRow(db, 'bill_overdue'))?._pending).toBeTruthy();
    expect(
      screen.getByText('As mudanças valem a partir da próxima verificação, em até 15 minutos.'),
    ).toBeDefined();
  });

  it('US-44: horário do diário e dia/hora do resumo', async () => {
    const auth = await seeded();
    const db = dbOf(auth);
    mount(auth);
    const daily = within(await screen.findByTestId('pref-daily-time')).getByLabelText('Horário');
    expect(daily).toHaveValue('20:00');
    fireEvent.change(daily, { target: { value: '21:30' } });
    await waitFor(async () =>
      expect(hhmm((await kindRow(db, 'daily_log'))?.local_time ?? '')).toBe('21:30'),
    );
    fireEvent.change(within(screen.getByTestId('pref-weekly-day')).getByLabelText('Dia'), {
      target: { value: '1' },
    });
    await waitFor(async () => expect((await kindRow(db, 'weekly_summary'))?.weekday).toBe(1));
    fireEvent.change(within(screen.getByTestId('pref-weekly-time')).getByLabelText('Horário'), {
      target: { value: '08:30' },
    });
    await waitFor(async () =>
      expect(hhmm((await kindRow(db, 'weekly_summary'))?.local_time ?? '')).toBe('08:30'),
    );
  });

  it('US-44/RN-86: janela de silêncio no perfil (padrão 22:00–08:00)', async () => {
    const auth = await seeded();
    const db = dbOf(auth);
    await db.profiles.put(
      makeRow('profiles', { id: auth.user?.userId ?? '', settings: {}, deleted_at: null }),
    );
    mount(auth);
    const start = within(await screen.findByTestId('quiet-start')).getByLabelText('Início');
    expect(start).toHaveValue('22:00');
    fireEvent.change(start, { target: { value: '23:00' } });
    await waitFor(async () =>
      expect(quietHoursOf((await db.profiles.toCollection().first())?.settings)).toEqual({
        start: '23:00',
        end: '08:00',
      }),
    );
  });

  it('US-44: valores inválidos são ignorados; tipo sem linha (perfil antigo) ganha a linha do seed', async () => {
    const auth = fakeAuth();
    const db = dbOf(auth);
    const userId = auth.user?.userId ?? '';
    expect(await setSchedule(db, userId, 'daily_log', { time: '25:00' })).toBe(false);
    expect(await setSchedule(db, userId, 'weekly_summary', { weekday: 9 })).toBe(false);
    expect(await setQuietHours(db, { start: 'x' })).toBe(false);
    expect(groupEnabled([], 'bank')).toBe(true);
    expect(await setGroupEnabled(db, userId, 'bank', false)).toBe(1);
    expect((await db.reminders.get(seedReminderId(userId, 'bank_connection')))?.enabled).toBe(
      false,
    );
    // ligar de novo muda só o que está diferente
    expect(await setGroupEnabled(db, userId, 'bank', true)).toBe(1);
    expect(await setGroupEnabled(db, userId, 'bank', true)).toBe(0);
  });
});
