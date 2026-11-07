// US-44 (T-093): as preferências gravadas na S07 valem a partir do tick seguinte — tipo desligado não avisa, o
// diário e o resumo seguem o horário e o dia escolhidos e o push respeita a janela de silêncio do perfil (RN-86).
import assert from 'node:assert/strict';
import { planUser, type SnapshotReminder, tickPrefs, type UserSnapshot } from './tick.ts';

const TZ = 'America/Sao_Paulo';
const brt = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`);

const pref = (over: Partial<SnapshotReminder> & { kind: string }): SnapshotReminder => ({
  enabled: true,
  localTime: '09:00',
  weekday: null,
  daysBefore: [0],
  skipIfLoggedToday: true,
  ...over,
});

const snap = (over: Partial<UserSnapshot> = {}): UserSnapshot => ({
  userId: '0a000000-0000-4000-8000-000000000044',
  timezone: TZ,
  settings: {},
  hasPush: true,
  reminders: [],
  cards: {},
  invoices: [],
  txs: [],
  loggedOn: [],
  ...over,
});

const opts = { pushEnabled: true, appOrigin: 'https://app.example.test/' };

Deno.test('US-44: diário desligado na S07 não avisa no tick seguinte', () => {
  const on = planUser(snap(), brt('2026-11-10', '20:00'), opts);
  assert.equal(on.notices.filter((n) => n.kind === 'daily_log').length, 1);
  const off = planUser(
    snap({ reminders: [pref({ kind: 'daily_log', enabled: false, localTime: '20:00' })] }),
    brt('2026-11-10', '20:00'),
    opts,
  );
  assert.equal(off.notices.filter((n) => n.kind === 'daily_log').length, 0);
});

Deno.test('US-44: diário às 21:30 escolhido na S07 sai às 21:30, não às 20:00', () => {
  const s = snap({ reminders: [pref({ kind: 'daily_log', localTime: '21:30' })] });
  assert.equal(
    planUser(s, brt('2026-11-10', '20:00'), opts).notices.filter((n) => n.kind === 'daily_log')
      .length,
    0,
  );
  assert.equal(
    planUser(s, brt('2026-11-10', '21:30'), opts).notices.filter((n) => n.kind === 'daily_log')
      .length,
    1,
  );
});

Deno.test('US-44/RN-86: janela de silêncio do perfil adia o push do resumo para o fim dela', () => {
  const s = snap({
    settings: { quietHours: { start: '18:00', end: '07:30' } },
    month: {
      txs: [],
      recurrences: [],
      accounts: [],
      cards: [],
      categories: [],
      invoiceMonths: {},
      budgets: [],
    },
    reminders: [pref({ kind: 'weekly_summary', localTime: '19:00', weekday: 0 })],
  });
  const plan = planUser(s, brt('2026-11-15', '19:00'), opts);
  const push = plan.outbox.find((o) => o.kind === 'weekly_summary');
  // o aviso entra na central na hora; o push vai às 07:30 do dia seguinte
  assert.ok(plan.notices.some((n) => n.kind === 'weekly_summary'));
  assert.equal(push?.scheduledFor, brt('2026-11-16', '07:30').toISOString());
});

Deno.test('US-44: horários e dia do resumo vêm das linhas da S07', () => {
  const prefs = tickPrefs([pref({ kind: 'weekly_summary', localTime: '08:30', weekday: 1 })]);
  const weekly = prefs.find((p) => p.kind === 'weekly_summary');
  assert.equal(weekly?.localTime, '08:30');
  assert.equal(weekly?.weekday, 1);
});
