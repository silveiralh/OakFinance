// US-55 (T-089): notas `pending` (lidas sem rede) são relidas quando a rede volta e a cada abertura do app; e, na
// T02, o selo "Aguardando nota" e o "Tentar ler a nota de novo" por 7 dias (RN-84).
import { type ISODate, todayIn } from '@oakfinance/domain';
import { ReceiptText, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AuthValue } from '../../app/auth';
import { useAuth } from '../../app/auth';
import type { LocalRow } from '../../data/db';
import { useLive } from '../../data/live';
import { t } from '../../i18n/pt-BR';
import { useOnline } from '../../lib/online';
import { Badge, Button } from '../../ui';
import { type NfceRetryDeps, rereadNfce, retryPendingNfce } from './flow';
import { canRetryRead } from './model';
import { type NfceRead, readNfce } from './receipts';

function today(): ISODate {
  return todayIn('America/Sao_Paulo', new Date()) as ISODate;
}

function depsOf(auth: AuthValue): NfceRetryDeps | null {
  const { user, client } = auth;
  if (!user) {
    return null;
  }
  return {
    db: user.db,
    userId: user.userId,
    today: today(),
    // sem o cliente (ainda carregando sob demanda) a nota continua pendente, sem virar parcial
    read: (raw): Promise<NfceRead> =>
      client ? readNfce(client, raw) : Promise.resolve({ status: 'pending' }),
  };
}

/** Novas tentativas, com a rede de volta, enquanto alguma nota segue pendente. */
export const NFCE_RETRY_DELAYS_MS = [5_000, 15_000, 45_000] as const;

/** Relê as notas pendentes ao abrir e a cada volta da rede (US-55). */
export function NfceRetryKeeper() {
  const auth = useAuth();
  const online = useOnline();
  const latest = useRef(auth);
  latest.current = auth;
  const userId = auth.user?.userId ?? null;
  const hasClient = auth.client !== null && auth.client !== undefined;
  useEffect(() => {
    if (!online || !userId || !hasClient) {
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = async (n: number) => {
      const deps = depsOf(latest.current);
      if (!alive || !deps) {
        return;
      }
      const result = await retryPendingNfce(deps).catch(() => ({ full: 0, pending: 0 }));
      if (result.full > 0) {
        latest.current.user?.engine.notifyWrite();
      }
      const delay = NFCE_RETRY_DELAYS_MS[n];
      if (alive && result.pending > 0 && delay !== undefined) {
        timer = setTimeout(() => void attempt(n + 1), delay);
      }
    };
    void attempt(0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [userId, hasClient, online]);
  return null;
}

/** T02: estado da nota ligada ao lançamento. */
export function NfceTxStatus({ tx }: { tx: LocalRow<'transactions'> }) {
  const auth = useAuth();
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const receiptId = tx.nfce_receipt_id;
  const receipt = useLive(
    auth.user && receiptId
      ? async () => (await auth.user?.db.nfce_receipts.get(receiptId)) ?? null
      : null,
    [auth.user, receiptId],
  );
  if (!receipt || receipt.deleted_at !== null || receipt.parse_status === 'full') {
    return null;
  }
  const retry = async () => {
    const deps = depsOf(auth);
    if (!deps) {
      return;
    }
    setBusy(true);
    try {
      if ((await rereadNfce(receipt, deps)) !== receipt.parse_status) {
        auth.user?.engine.notifyWrite();
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="nfce-status" data-testid="nfce-status" data-status={receipt.parse_status}>
      {receipt.parse_status === 'pending' && (
        <Badge
          tone="warning"
          icon={ReceiptText}
          label={t('nfce.pendingBadge')}
          data-testid="nfce-pending"
        />
      )}
      {canRetryRead(receipt, today()) && (
        <Button
          variant="secondary"
          iconStart={RefreshCw}
          loading={busy}
          disabled={!online}
          onClick={() => void retry()}
          data-testid="nfce-retry"
        >
          {t('nfce.retry')}
        </Button>
      )}
    </div>
  );
}
