// T02 — Detalhe do lançamento (US-13, US-14, RN-97..RN-99): valor, `<dl>` com os dados, Editar (Q01 em modo
// edição), Excluir com "Desfazer" por 8 s e o Histórico do servidor (online), com "Restaurar esta versão".
import { type ISODate, monthLabel, todayIn, type YearMonth } from '@oakfinance/domain';
import { ArrowRightLeft, History, Pencil, Receipt, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAuth } from '../../app/auth';
import { useValuesHidden } from '../../app/values';
import type { LocalRow } from '../../data/db';
import { useLive } from '../../data/live';
import { deleteRow, restoreRow, saveRow } from '../../data/repositories/rows';
import { deviceId } from '../../data/sync/clock';
import { type MessageKey, t, uiText } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';
import { useOnline } from '../../lib/online';
import { Button, Dialog, EmptyState, GlassCard, MoneyText, Skeleton, useToast } from '../../ui';
import { movedRow } from '../cards/model';
import { movePlan } from '../cards/move';
import { SeriesActions } from '../installments/SeriesActions';
import { buildInvoice } from '../quick-entry/model';
import {
  describeHistory,
  type HistoryClient,
  type HistoryEntry,
  type HistoryNames,
  kindLabel,
  loadHistory,
  restoredRow,
} from './history';
import { methodLabel, toRow } from './TransactionsScreen';

type Tx = LocalRow<'transactions'>;

const ORIGIN_KEY: Readonly<Record<string, MessageKey>> = {
  manual: 'detail.origin.manual',
  pluggy: 'detail.origin.pluggy',
  ofx: 'detail.origin.ofx',
  csv: 'detail.origin.csv',
  nfce: 'detail.origin.nfce',
  recurrence: 'detail.origin.recurrence',
  installment: 'detail.origin.installment',
  system: 'detail.origin.system',
};

/** Lançamento avulso: sem série de parcelas e sem recorrência (exclusões de série ficam para T-053/T-055). */
export function isStandalone(tx: Tx): boolean {
  return tx.series_id === null && tx.recurrence_id === null;
}

type HistoryState =
  | { kind: 'offline' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; entries: HistoryEntry[] };

export function TransactionDetailScreen({
  today = todayIn('America/Sao_Paulo', new Date()),
}: {
  today?: string;
}) {
  const { id = '' } = useParams();
  const { user, client } = useAuth();
  const navigate = useNavigate();
  const showToast = useToast();
  const online = useOnline();
  const hidden = useValuesHidden();
  const data = useLive(
    user
      ? async () => {
          const tx = await user.db.transactions.get(id);
          return {
            tx: tx ?? null,
            categories: await user.db.categories.toArray(),
            accounts: await user.db.accounts.toArray(),
            cards: await user.db.cards.toArray(),
            invoice: tx?.invoice_id ? ((await user.db.invoices.get(tx.invoice_id)) ?? null) : null,
            cardInvoices: tx?.card_id
              ? await user.db.invoices.where('card_id').equals(tx.card_id).toArray()
              : [],
            cardTxs: tx?.card_id
              ? (await user.db.transactions.toArray()).filter(
                  (r) => r.card_id === tx.card_id || r.counterpart_card_id === tx.card_id,
                )
              : [],
          };
        }
      : null,
    [user, id],
  );
  const tx = data?.tx ?? null;
  const [device, setDevice] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (!user) {
      return;
    }
    // sem setState depois de desmontar (a transação do Dexie pode terminar depois)
    let alive = true;
    void deviceId(user.db).then((id) => alive && setDevice(id));
    return () => {
      alive = false;
    };
  }, [user]);
  const names: HistoryNames = useMemo(
    () => ({
      categories: new Map((data?.categories ?? []).map((c) => [c.id, c.name])),
      accounts: new Map((data?.accounts ?? []).map((a) => [a.id, a.name])),
      cards: new Map((data?.cards ?? []).map((c) => [c.id, c.name])),
      method: methodLabel,
      hidden,
    }),
    [data?.categories, data?.accounts, data?.cards, hidden],
  );

  const [history, setHistory] = useState<HistoryState>({ kind: 'loading' });
  const version = tx?.server_version ?? -1;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` relê o histórico a cada sync da linha
  useEffect(() => {
    if (!online || !client) {
      setHistory({ kind: 'offline' });
      return;
    }
    let alive = true;
    setHistory({ kind: 'loading' });
    loadHistory(client as unknown as HistoryClient, id)
      .then((entries) => alive && setHistory({ kind: 'ready', entries }))
      .catch(() => alive && setHistory({ kind: online ? 'error' : 'offline' }));
    return () => {
      alive = false;
    };
  }, [client, id, online, version]);

  if (!data) {
    return (
      <section className="screen" data-screen="T02" data-testid="screen-T02">
        <Skeleton shape="hero" />
      </section>
    );
  }
  if (!tx || tx.deleted_at !== null || !user) {
    return (
      <section className="screen" data-screen="T02" data-testid="screen-T02">
        <EmptyState
          variant="error"
          icon={Receipt}
          title={t('detail.notFound')}
          description=""
          primaryAction={{ label: t('detail.back'), onPress: () => void navigate('/lancamentos') }}
        />
      </section>
    );
  }

  const category = tx.category_id
    ? data.categories.find((c) => c.id === tx.category_id)
    : undefined;
  const row = toRow(tx, category, today as Parameters<typeof toRow>[2]);
  const status = statusText(row.state);
  // US-11: conta ou cartão arquivado continua com o nome e o selo "arquivada"
  const archivedTag = (row: { archived_at: string | null } | undefined) =>
    row?.archived_at ? ` · ${t('accounts.archivedBadge')}` : '';
  const accountRow = tx.account_id ? data.accounts.find((a) => a.id === tx.account_id) : undefined;
  const account = accountRow ? `${accountRow.name}${archivedTag(accountRow)}` : undefined;
  const cardOfTx = tx.card_id ? data.cards.find((c) => c.id === tx.card_id) : undefined;
  const card = cardOfTx ? `${cardOfTx.name}${archivedTag(cardOfTx)}` : undefined;
  const destination = tx.counterpart_account_id
    ? names.accounts.get(tx.counterpart_account_id)
    : tx.counterpart_card_id
      ? names.cards.get(tx.counterpart_card_id)
      : undefined;
  const invoice = data.invoice;
  const origin = ORIGIN_KEY[tx.source];

  const cardRow = tx.card_id ? data.cards.find((c) => c.id === tx.card_id) : undefined;
  const move = cardRow
    ? movePlan(cardRow, tx, data.cardTxs, data.cardInvoices, today as ISODate)
    : null;

  const moveTo = async (targetId: string) => {
    setMoving(false);
    const target = move?.targets.find((p) => p.id === targetId);
    if (!target) {
      return;
    }
    if (!(await user.db.invoices.get(target.id))) {
      await saveRow(
        user.db,
        'invoices',
        buildInvoice(target, user.userId, new Date().toISOString()),
      );
    }
    const result = await saveRow(user.db, 'transactions', movedRow(tx, target));
    if (!result.ok) {
      return;
    }
    user.engine.notifyWrite();
    showToast({ message: t('detail.moved', { mês: monthLabel(target.referenceMonth) }) });
  };

  const remove = async () => {
    const result = await deleteRow(user.db, 'transactions', tx.id);
    if (!result.ok) {
      return;
    }
    user.engine.notifyWrite();
    void navigate('/lancamentos');
    showToast({
      message: t('toast.deleted'),
      action: {
        label: t('toast.undo'),
        onPress: () => {
          void restoreRow(user.db, 'transactions', tx.id).then(() => user.engine.notifyWrite());
        },
      },
    });
  };

  const restore = async (versionRow: Record<string, unknown>) => {
    const next = restoredRow(tx, versionRow);
    if (!next) {
      return;
    }
    const result = await saveRow(user.db, 'transactions', next);
    if (!result.ok) {
      return;
    }
    user.engine.notifyWrite();
    showToast({ message: t('history.restoredToast'), tone: 'success' });
  };

  const items =
    history.kind === 'ready' ? describeHistory(history.entries, tx, device, names, today) : [];
  const empty = t('detail.empty');

  const pairs: [MessageKey, string][] = [
    ['detail.field.kind', kindLabel(tx.kind)],
    ['detail.field.status', status],
    ['detail.field.category', category?.name ?? empty],
    ['detail.field.method', methodLabel(tx.payment_method) || empty],
    ...(account ? ([['detail.field.account', account]] as [MessageKey, string][]) : []),
    ...(card ? ([['detail.field.card', card]] as [MessageKey, string][]) : []),
    ...(destination ? ([['detail.field.destination', destination]] as [MessageKey, string][]) : []),
    ...(invoice
      ? ([
          [
            'detail.field.invoice',
            t('detail.invoice', {
              mês: monthLabel(invoice.reference_month.slice(0, 7) as YearMonth),
              data: formatDateBR(invoice.due_date as Parameters<typeof formatDateBR>[0]),
            }),
          ],
        ] as [MessageKey, string][])
      : []),
    ['detail.field.date', row.when],
    ['detail.field.description', tx.description || empty],
    ['detail.field.notes', tx.notes || empty],
    ['detail.field.origin', origin ? t(origin) : empty],
  ];

  return (
    <section className="screen" data-screen="T02" data-testid="screen-T02">
      <GlassCard level={1}>
        <div className="detail-hero">
          <MoneyText
            value={tx.amount_cents}
            kind={row.kind}
            size="hero"
            showSign
            data-testid="detail-amount"
          />
          <p className="detail-sub">
            {kindLabel(tx.kind)} · {status}
          </p>
        </div>
      </GlassCard>
      <GlassCard level={1}>
        <dl className="detail-list" data-testid="detail-list">
          {pairs.map(([key, value]) => (
            <div key={key}>
              <dt>{t(key)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </GlassCard>
      <div className="detail-actions">
        {tx.series_id ? (
          <SeriesActions
            user={user}
            tx={tx}
            categories={data.categories}
            today={today as ISODate}
          />
        ) : (
          <Button
            variant="secondary"
            iconStart={Pencil}
            onClick={() => void navigate(`?editar=${tx.id}`)}
          >
            {t('list.edit')}
          </Button>
        )}
        {move?.allowed && (
          <Button variant="secondary" iconStart={ArrowRightLeft} onClick={() => setMoving(true)}>
            {t('tx.move')}
          </Button>
        )}
        {isStandalone(tx) && (
          <Button variant="danger" iconStart={Trash2} onClick={() => void remove()}>
            {t('list.delete')}
          </Button>
        )}
      </div>
      <Dialog
        open={moving}
        title={t('tx.move')}
        description={t('detail.moveHint')}
        options={(move?.targets ?? []).map((p) => ({
          value: p.id,
          label: t('detail.moveTo', { mês: monthLabel(p.referenceMonth) }),
        }))}
        onChoose={(value) => void moveTo(value)}
        onCancel={() => setMoving(false)}
        data-testid="move-dialog"
      />
      <GlassCard level={1} title={t('history.title')} headingLevel={2}>
        <div className="detail-history" data-testid="detail-history" aria-live="polite">
          {history.kind === 'offline' && <p className="detail-note">{t('history.offline')}</p>}
          {history.kind === 'loading' && <p className="detail-note">{t('history.loading')}</p>}
          {history.kind === 'error' && <p className="detail-note">{t('history.error')}</p>}
          {history.kind === 'ready' && items.length === 0 && (
            <p className="detail-note">{t('history.empty')}</p>
          )}
          {items.length > 0 && (
            <ul className="detail-history-list">
              {items.map((item) => (
                <li
                  key={item.key}
                  data-testid="history-item"
                  data-conflict={item.conflict || undefined}
                >
                  <History aria-hidden="true" size={20} />
                  <div>
                    <p className="detail-history-title">{item.title}</p>
                    {item.lines.map((line) => (
                      <p key={line} className="detail-history-line">
                        {line}
                      </p>
                    ))}
                    <p className="detail-note">
                      {item.when} · {item.device}
                    </p>
                    {item.version && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => item.version && void restore(item.version)}
                      >
                        {t('tx.history.restore')}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </GlassCard>
    </section>
  );
}

const STATE_TEXT: Readonly<Record<NonNullable<ReturnType<typeof toRow>['state']>, string>> = {
  cancelled: uiText.stateCancelled,
  late: uiText.stateLate,
  forecast: uiText.stateForecast,
  to_receive: uiText.stateToReceive,
  scheduled: uiText.stateScheduled,
};

/** Status em texto (UX T02): Agendada · Prevista · A receber · Atrasada · Cancelada, ou Efetivada. */
function statusText(state: ReturnType<typeof toRow>['state']): string {
  return state ? STATE_TEXT[state] : t('detail.status.posted');
}
