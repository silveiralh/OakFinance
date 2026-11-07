// ON04 — Lembretes (UX §3 ON04, US-08): os tipos com Switch (ligados por padrão) gravam `reminders.enabled`;
// "Ativar lembretes" pede a permissão só no toque e inscreve o aparelho; iPhone fora da Tela de Início vê o aviso.
import { Bell } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../app/auth';
import type { OakDb } from '../../data/db';
import { saveRow } from '../../data/repositories/rows';
import { deviceId } from '../../data/sync/clock';
import { type MessageKey, t } from '../../i18n/pt-BR';
import { getEnv } from '../../lib/env';
import { baseState, enablePush, type PushEnvironment, readEnvironment } from '../../lib/push';
import { Button, Switch, useToast } from '../../ui';
import { OnbFrame, useOnbStep } from './OnbFrame';

/** Os quatro grupos da UX §3 ON04 e os tipos de `reminders` que cada um liga. */
export const REMINDER_GROUPS = [
  {
    id: 'due',
    label: 'onb.notif.due',
    hint: 'onb.notif.dueHint',
    kinds: ['invoice_due', 'bill_due'],
  },
  { id: 'daily', label: 'onb.notif.daily', hint: 'onb.notif.dailyHint', kinds: ['daily_log'] },
  {
    id: 'weekly',
    label: 'onb.notif.weekly',
    hint: 'onb.notif.weeklyHint',
    kinds: ['weekly_summary'],
  },
  {
    id: 'budget',
    label: 'onb.notif.budget',
    hint: 'onb.notif.budgetHint',
    kinds: ['budget_threshold'],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: MessageKey;
  hint: MessageKey;
  kinds: readonly string[];
}>;

export type GroupId = (typeof REMINDER_GROUPS)[number]['id'];
export type GroupChoice = Record<GroupId, boolean>;

const ALL_ON: GroupChoice = { due: true, daily: true, weekly: true, budget: true };

/** Grava `enabled` nos lembretes (seeds) dos tipos de cada grupo; só muda o que for diferente. */
export async function applyReminderChoice(db: OakDb, choice: GroupChoice): Promise<number> {
  const rows = await db.reminders.toArray();
  let changed = 0;
  for (const group of REMINDER_GROUPS) {
    for (const row of rows) {
      if (
        row.deleted_at === null &&
        (group.kinds as readonly string[]).includes(row.kind) &&
        row.enabled !== choice[group.id]
      ) {
        const result = await saveRow(db, 'reminders', { ...row, enabled: choice[group.id] });
        changed += result.ok ? 1 : 0;
      }
    }
  }
  return changed;
}

function vapidKey(): string | null {
  try {
    return getEnv().vapidPublicKey;
  } catch {
    return null;
  }
}

export function RemindersStep({ environment }: { environment?: PushEnvironment }) {
  const { client } = useAuth();
  const { user, busy, advance } = useOnbStep('reminders');
  const showToast = useToast();
  const [env] = useState(() => environment ?? readEnvironment());
  const key = vapidKey();
  const state = baseState(env, key);
  const [choice, setChoice] = useState<GroupChoice>(ALL_ON);
  const [asking, setAsking] = useState(false);

  const save = async () => {
    if (user) {
      await applyReminderChoice(user.db, choice);
    }
  };
  const activate = async () => {
    setAsking(true);
    try {
      await save();
      if (client && user && key && state === 'off') {
        const result = await enablePush(client, key, await deviceId(user.db)).catch(() => 'off');
        if (result === 'denied') {
          showToast({ message: t('onb.notif.denied'), tone: 'warning' });
        }
      }
      await advance('done');
    } finally {
      setAsking(false);
    }
  };
  const later = async () => {
    await save();
    await advance('skip');
  };

  const iosBlocked = state === 'ios-not-installed';
  const canAsk = state === 'off';
  return (
    <OnbFrame
      step="reminders"
      title={t('onb.notif.title')}
      onSkip={() => void later()}
      primary={
        canAsk ? (
          <Button
            fullWidth
            loading={asking}
            disabled={busy}
            onClick={() => void activate()}
            data-testid="onb-notif-activate"
          >
            {t('onb.notif.cta')}
          </Button>
        ) : (
          <Button
            fullWidth
            disabled={busy}
            onClick={() => void activate()}
            data-testid="onb-continue"
          >
            {t('common.continue')}
          </Button>
        )
      }
      skipLabel={t('onb.install.later')}
    >
      <span className="onb-icon" aria-hidden="true">
        <Bell size={32} />
      </span>
      {iosBlocked ? (
        <p role="status" data-testid="onb-notif-ios">
          {t('onb.notif.iosNotInstalled')}
        </p>
      ) : (
        <>
          {state === 'denied' && <p role="status">{t('onb.notif.denied')}</p>}
          {REMINDER_GROUPS.map((group) => (
            <Switch
              key={group.id}
              label={t(group.label)}
              description={t(group.hint)}
              checked={choice[group.id]}
              onChange={(checked) => setChoice({ ...choice, [group.id]: checked })}
              data-testid={`onb-notif-${group.id}`}
            />
          ))}
        </>
      )}
    </OnbFrame>
  );
}
