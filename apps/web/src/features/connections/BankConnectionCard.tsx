// BankConnectionCard (UX §3 I01): estado, "Atualizado hoje às 07:40", "Expira em {n} dias" (só com data),
// "Atualizar agora" (no máximo 1 vez por hora, RN-80) e o resumo da última sincronização. Sem rede, o botão fica
// desativado com "Precisa de internet". Renovar e os estados de erro detalhados entram na T-077.
import { AlertTriangle, CheckCircle2, Clock, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../app/auth';
import type { LocalRow } from '../../data/db';
import { useLive } from '../../data/live';
import { t } from '../../i18n/pt-BR';
import { useOnline } from '../../lib/online';
import { Badge, Button, GlassCard } from '../../ui';
import { type MapClient, refreshNow, withE2e } from './api';
import {
  bankName,
  connectionState,
  daysUntil,
  errorText,
  refreshWait,
  type SyncSummary,
  updatedText,
} from './model';
import { readSummary, summarizeSince } from './summary';

const BADGES = {
  active: { tone: 'success', icon: CheckCircle2 },
  updating: { tone: 'info', icon: RefreshCw },
  expiring: { tone: 'warning', icon: Clock },
  expired: { tone: 'danger', icon: AlertTriangle },
  error: { tone: 'danger', icon: AlertTriangle },
} as const;

export function BankConnectionCard({ connection }: { connection: LocalRow<'bank_connections'> }) {
  const auth = useAuth();
  const { user } = auth;
  const client = auth.client ? withE2e(auth.client as typeof auth.client & MapClient) : null;
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const summary = useLive<SyncSummary | null>(
    user ? () => readSummary(user.db, connection.id) : null,
    [user?.userId, connection.id],
  );
  const now = Date.now();
  const banco = bankName(connection);
  const state = connectionState(connection, now);
  const days = daysUntil(connection.consent_expires_at, now);
  const updated = updatedText(connection.last_success_at, now);

  const refresh = async () => {
    if (!user || !client) {
      return;
    }
    const wait = refreshWait(connection.last_manual_refresh_at, Date.now());
    if (wait) {
      setMessage(t('conn.refreshTooSoon', { n: wait.ago, m: wait.wait }));
      return;
    }
    setBusy(true);
    setMessage(null);
    const startedAt = new Date().toISOString();
    const result = await refreshNow(client, connection.id);
    if (!result.ok) {
      setMessage(
        result.code === 'REFRESH_TOO_SOON'
          ? t('conn.refreshTooSoon', { n: 0, m: 60 })
          : errorText(result, banco),
      );
      setBusy(false);
      return;
    }
    await user.engine.syncNow();
    await summarizeSince(user.db, connection.id, startedAt);
    setBusy(false);
  };

  return (
    <GlassCard
      as="li"
      level={2}
      className="bank-connection"
      data-testid={`bank-connection-${connection.id}`}
    >
      <div className="bank-connection-head">
        <h3>{banco}</h3>
        <Badge {...BADGES[state]} label={t(`conn.state.${state}`)} />
      </div>
      {updated && <p className="account-meta">{updated}</p>}
      {days !== null && days > 0 && (
        <p className="account-meta">{t('conn.expiresIn', { n: days })}</p>
      )}
      {summary && (
        <p className="account-meta" data-testid="bank-connection-summary">
          {t('conn.summary', { n: summary.fresh, m: summary.linked, k: summary.review })}
        </p>
      )}
      {message && (
        <p className="account-meta" role="status">
          {message}
        </p>
      )}
      <Button
        variant="secondary"
        iconStart={RefreshCw}
        loading={busy}
        disabled={!online}
        disabledReason={t('conn.needsInternet')}
        onClick={() => void refresh()}
      >
        {t('conn.refresh')}
      </Button>
    </GlassCard>
  );
}
