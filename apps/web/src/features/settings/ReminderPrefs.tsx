// S07 — preferências por tipo (T-093; US-44): Switch por tipo, horário do diário, dia e hora do resumo semanal e a
// janela de silêncio. Grava no aparelho (sincroniza) e o servidor aplica no tick seguinte.
import { useId } from 'react';
import { useAuth } from '../../app/auth';
import { useLive } from '../../data/live';
import { t } from '../../i18n/pt-BR';
import { GlassCard, Select, Switch } from '../../ui';
import {
  groupEnabled,
  PREF_GROUPS,
  type PrefGroupId,
  quietHoursOf,
  scheduleOf,
  setGroupEnabled,
  setQuietHours,
  setSchedule,
} from './reminder-prefs';

const WEEKDAYS = [
  'reminders.weekday.0',
  'reminders.weekday.1',
  'reminders.weekday.2',
  'reminders.weekday.3',
  'reminders.weekday.4',
  'reminders.weekday.5',
  'reminders.weekday.6',
] as const;

function TimeField({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
}) {
  const id = useId();
  return (
    <div className="field" data-testid={testId}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="field-box">
        <input
          id={id}
          type="time"
          value={value}
          step={300}
          onChange={(event) => event.target.value && onChange(event.target.value)}
        />
      </div>
    </div>
  );
}

export function ReminderPrefs() {
  const { user } = useAuth();
  const data = useLive(
    user
      ? async () => ({
          rows: await user.db.reminders.toArray(),
          settings: (await user.db.profiles.toCollection().first())?.settings ?? null,
        })
      : null,
    [user],
  );
  if (!user || !data) {
    return null;
  }
  const done = (ok: boolean | number) => {
    if (ok) {
      user.engine.notifyWrite();
    }
  };
  const toggle = (group: PrefGroupId, enabled: boolean) =>
    void setGroupEnabled(user.db, user.userId, group, enabled).then(done);
  const daily = scheduleOf(data.rows, 'daily_log');
  const weekly = scheduleOf(data.rows, 'weekly_summary');
  const quiet = quietHoursOf(data.settings);
  return (
    <>
      <GlassCard
        level={1}
        title={t('reminders.types')}
        headingLevel={2}
        data-testid="reminder-prefs"
      >
        {PREF_GROUPS.map((group) => (
          <div key={group.id} className="reminder-pref" data-testid={`pref-${group.id}`}>
            <Switch
              label={t(group.label)}
              description={t(group.hint)}
              checked={groupEnabled(data.rows, group.id)}
              onChange={(on) => toggle(group.id, on)}
            />
            {group.id === 'daily' && groupEnabled(data.rows, 'daily') && (
              <TimeField
                label={t('reminders.time')}
                value={daily.time}
                testId="pref-daily-time"
                onChange={(time) =>
                  void setSchedule(user.db, user.userId, 'daily_log', { time }).then(done)
                }
              />
            )}
            {group.id === 'weekly' && groupEnabled(data.rows, 'weekly') && (
              <div className="reminder-pref-row">
                <Select
                  label={t('reminders.day')}
                  value={String(weekly.weekday ?? 0)}
                  options={WEEKDAYS.map((key, i) => ({ value: String(i), label: t(key) }))}
                  onChange={(value) =>
                    void setSchedule(user.db, user.userId, 'weekly_summary', {
                      weekday: Number(value),
                    }).then(done)
                  }
                  data-testid="pref-weekly-day"
                />
                <TimeField
                  label={t('reminders.time')}
                  value={weekly.time}
                  testId="pref-weekly-time"
                  onChange={(time) =>
                    void setSchedule(user.db, user.userId, 'weekly_summary', { time }).then(done)
                  }
                />
              </div>
            )}
          </div>
        ))}
      </GlassCard>
      <GlassCard level={1} title={t('reminders.quiet')} headingLevel={2} data-testid="quiet-hours">
        <p className="reminders-hint">{t('reminders.quietHint')}</p>
        <div className="reminder-pref-row">
          <TimeField
            label={t('reminders.quietStart')}
            value={quiet.start}
            testId="quiet-start"
            onChange={(start) => void setQuietHours(user.db, { start }).then(done)}
          />
          <TimeField
            label={t('reminders.quietEnd')}
            value={quiet.end}
            testId="quiet-end"
            onChange={(end) => void setQuietHours(user.db, { end }).then(done)}
          />
        </div>
      </GlassCard>
      <p className="reminders-hint">{t('reminders.nextTick')}</p>
    </>
  );
}
