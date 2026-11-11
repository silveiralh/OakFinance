// S11 — Diagnóstico (UX §3 S01, tech §7.3, US-64): versão e aparelho, armazenamento persistente e cota, alterações
// pendentes e rejeitadas (com "Tentar de novo" e "Descartar e restaurar do servidor"), último envio e recebimento e
// o cursor, lembretes no aparelho, conexões bancárias e os últimos eventos da telemetria deste aparelho.
import { RotateCcw, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../../app/auth';
import { OPEN_FINANCE_ENABLED } from '../../app/openFinance';
import { useSyncSnapshot } from '../../app/SyncStatus';
import type { OutboxEntry } from '../../data/db';
import { useLive } from '../../data/live';
import { estimateStorage, getStorageStatus, type StorageEstimate } from '../../data/storage';
import { deviceId } from '../../data/sync/clock';
import { discardRejected, rejectedEntries, retryRejected } from '../../data/sync/outbox';
import { type MessageKey, t } from '../../i18n/pt-BR';
import { appVersion } from '../../lib/env';
import { currentSubscription } from '../../lib/push';
import { recentEvents, type TelemetryEvent } from '../../lib/telemetry';
import { Button, GlassCard, useToast } from '../../ui';

const TIME_ZONE = 'America/Sao_Paulo';

/** "07/11/2026 02:06" no fuso de São Paulo; texto que não é data vira "Nunca". */
export function formatStamp(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    return t('diag.never');
  }
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

/** "12,3 MB" (uma casa, vírgula decimal); abaixo de 1 MB, em KB. */
export function formatBytes(bytes: number): string {
  const [value, unit] = bytes >= 1024 * 1024 ? [bytes / (1024 * 1024), 'MB'] : [bytes / 1024, 'KB'];
  const tenths = Math.round(value * 10);
  return `${Math.floor(tenths / 10)},${tenths % 10} ${unit}`;
}

export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported';

function pushPermission(): PushPermission {
  if (typeof Notification === 'undefined') {
    return 'unsupported';
  }
  return Notification.permission;
}

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="diag-row">
      <dt>{label}</dt>
      <dd {...(testId ? { 'data-testid': testId } : {})}>{value}</dd>
    </div>
  );
}

function RejectedItem({ entry }: { entry: OutboxEntry }) {
  const { user } = useAuth();
  const showToast = useToast();
  const [busy, setBusy] = useState(false);
  if (!user) {
    return null;
  }
  const act = async (kind: 'retry' | 'discard') => {
    setBusy(true);
    try {
      const done =
        kind === 'retry'
          ? await retryRejected(user.db, entry.mutation_id)
          : await discardRejected(user.db, entry.mutation_id);
      if (done) {
        void user.engine.syncNow();
        showToast({ message: t(kind === 'retry' ? 'diag.retried' : 'diag.discarded') });
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="diag-rejected" data-testid="diag-rejected-item">
      <p>
        {t('diag.rejected.item', {
          tabela: entry.table,
          codigo: entry.last_error ?? '—',
          data: formatStamp(entry.created_at),
        })}
      </p>
      <Button
        variant="secondary"
        iconStart={RotateCcw}
        loading={busy}
        onClick={() => void act('retry')}
      >
        {t('diag.retry')}
      </Button>
      <Button variant="ghost" iconStart={Undo2} loading={busy} onClick={() => void act('discard')}>
        {t('diag.discard')}
      </Button>
    </li>
  );
}

interface Static {
  device: string;
  estimate: StorageEstimate | null;
}

export function DiagnosticsScreen() {
  const { user } = useAuth();
  const snapshot = useSyncSnapshot();
  const [info, setInfo] = useState<Static | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const live = useLive(
    user
      ? async () => ({
          rejected: await rejectedEntries(user.db),
          state: new Map((await user.db.sync_state.toArray()).map((e) => [e.key, e.value])),
          connections: (await user.db.bank_connections.toArray()).filter(
            (c) => c.deleted_at === null,
          ),
          events: await recentEvents(user.db),
        })
      : null,
    [user],
  );

  useEffect(() => {
    if (!user) {
      return;
    }
    let alive = true;
    void Promise.all([deviceId(user.db), estimateStorage()]).then(([device, estimate]) => {
      if (alive) {
        setInfo({ device, estimate });
      }
    });
    // Sem service worker ativo, `serviceWorker.ready` nunca resolve: a inscrição chega quando der.
    void currentSubscription().then((subscription) => {
      if (alive && subscription !== null) {
        setSubscribed(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [user]);

  if (!user || !live) {
    return <section className="screen" data-screen="S11" data-testid="screen-S11" />;
  }
  const persisted = getStorageStatus().persisted;
  const estimate = info?.estimate ?? null;
  const permission = pushPermission();
  return (
    <section className="screen diag" data-screen="S11" data-testid="screen-S11">
      <GlassCard level={2} className="diag-block">
        <h2>{t('diag.app')}</h2>
        <dl>
          <Row label={t('diag.version')} value={appVersion()} testId="diag-version" />
          <Row label={t('diag.device')} value={info?.device ?? '…'} testId="diag-device" />
          <Row
            label={t('diag.storage')}
            value={
              persisted === null
                ? t('diag.unknown')
                : t(persisted ? 'diag.persisted' : 'diag.notPersisted')
            }
            testId="diag-persisted"
          />
          <Row
            label={t('diag.usageLabel')}
            value={
              estimate
                ? t('diag.usage', {
                    usado: formatBytes(estimate.usage),
                    total: formatBytes(estimate.quota),
                  })
                : t('diag.unknown')
            }
            testId="diag-usage"
          />
        </dl>
        {estimate?.high && <p role="alert">{t('diag.usageHigh')}</p>}
      </GlassCard>

      <GlassCard level={2} className="diag-block">
        <h2>{t('diag.sync')}</h2>
        <dl>
          <Row
            label={t('diag.pending')}
            value={String(snapshot?.pending ?? 0)}
            testId="diag-pending"
          />
          <Row
            label={t('diag.lastPush')}
            value={formatStamp(live.state.get('last_push_at'))}
            testId="diag-last-push"
          />
          <Row
            label={t('diag.lastPull')}
            value={formatStamp(live.state.get('last_pull_at'))}
            testId="diag-last-pull"
          />
          <Row
            label={t('diag.cursor')}
            value={String(live.state.get('cursor') ?? 0)}
            testId="diag-cursor"
          />
        </dl>
        <h3>{t('diag.rejected')}</h3>
        {live.rejected.length === 0 ? (
          <p data-testid="diag-rejected-none">{t('diag.rejected.none')}</p>
        ) : (
          <ul className="diag-list">
            {live.rejected.map((entry) => (
              <RejectedItem key={entry.mutation_id} entry={entry} />
            ))}
          </ul>
        )}
      </GlassCard>

      <GlassCard level={2} className="diag-block">
        <h2>{t('diag.push')}</h2>
        <p data-testid="diag-push">
          {t(`diag.push.${permission}` as MessageKey)} ·{' '}
          {t(subscribed ? 'diag.push.subscribed' : 'diag.push.notSubscribed')}
        </p>
        {OPEN_FINANCE_ENABLED && (
          <>
            <h2>{t('diag.connections')}</h2>
            {live.connections.length === 0 ? (
              <p>{t('diag.connections.none')}</p>
            ) : (
              <ul className="diag-list">
                {live.connections.map((c) => (
                  <li key={c.id}>
                    <p>
                      {t('diag.connections.item', {
                        banco: c.institution ?? c.connector_name ?? c.provider,
                        status: c.status,
                        data: formatStamp(c.last_success_at),
                      })}
                    </p>
                    {c.consent_expires_at && (
                      <p>
                        {t('diag.connections.consent', { data: formatStamp(c.consent_expires_at) })}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </GlassCard>

      <GlassCard level={2} className="diag-block">
        <h2>{t('diag.events')}</h2>
        {live.events.length === 0 ? (
          <p>{t('diag.events.none')}</p>
        ) : (
          <ol className="diag-list" data-testid="diag-events">
            {live.events.map((event: TelemetryEvent) => (
              <li key={`${event.at}-${event.code}-${event.level}`}>
                <code>{event.code}</code> · {formatStamp(event.at)}
              </li>
            ))}
          </ol>
        )}
      </GlassCard>
    </section>
  );
}
