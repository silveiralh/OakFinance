// I04 — Ler nota NFC-e (T-089; UX §3 I04, §5.31; US-54, US-55; RN-83..RN-85): câmera, foto ou chave → leitura
// pelo `nfce-fetch` → resultado (loja, data, valor, itens) → "Usar estes dados" abre o Q01 pré-preenchido.
import { formatBRL, type ISODate } from '@oakfinance/domain';
import { Check, CloudOff, Info, ReceiptText, TriangleAlert } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import type { LocalRow } from '../../data/db';
import { useLive } from '../../data/live';
import { t } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';
import { useOnline } from '../../lib/online';
import { useToday } from '../../lib/useToday';
import { Banner, Button, GlassCard, MoneyText } from '../../ui';
import type { QuickEntryNfce } from '../quick-entry/QuickEntrySheet';
import { type NfceOutcome, processNfce } from './flow';
import { QrScanner } from './QrScanner';
import { readNfce } from './receipts';

const QuickEntrySheet = lazy(() =>
  import('../quick-entry/QuickEntrySheet').then((m) => ({ default: m.QuickEntrySheet })),
);

/** "06/11/2026" → "06/11" (RN-85 mostra dd/mm). */
function dayMonth(iso: string): string {
  return formatDateBR(iso.slice(0, 10) as ISODate).slice(0, 5);
}

type Prefill = Extract<NfceOutcome, { kind: 'prefill' }>;

function prefillOf(outcome: Prefill): QuickEntryNfce {
  return {
    receiptId: outcome.receipt.id,
    issuerCnpj: outcome.receipt.issuer_cnpj,
    issuerName: outcome.receipt.issuer_name,
    draft: outcome.draft,
  };
}

/** Sheet do resultado (UX §3 I04): loja, data, valor total e itens (lista recolhível). */
function ReceiptSummary({ outcome, onUse }: { outcome: Prefill; onUse: () => void }) {
  const { user } = useAuth();
  const receiptId = outcome.receipt.id;
  const items = useLive(
    user
      ? async () =>
          (await user.db.receipt_items.where('receipt_id').equals(receiptId).toArray()).sort(
            (a, b) => a.line_no - b.line_no,
          )
      : null,
    [user, receiptId],
  );
  const { draft } = outcome;
  return (
    <GlassCard level={1} data-testid="nfce-result">
      <dl className="detail-list">
        <div>
          <dt>{t('detail.field.description')}</dt>
          <dd>{draft.description}</dd>
        </div>
        <div>
          <dt>{t('detail.field.date')}</dt>
          <dd>{formatDateBR(draft.occurredOn)}</dd>
        </div>
        {draft.amountCents !== null && (
          <div>
            <dt>{t('detail.field.amount')}</dt>
            <dd>
              <MoneyText value={draft.amountCents} kind="neutral" />
            </dd>
          </div>
        )}
      </dl>
      {items && items.length > 0 && (
        <details className="nfce-items" data-testid="nfce-items">
          <summary>{t('nfce.items', { n: items.length })}</summary>
          <ul>
            {items.map((item: LocalRow<'receipt_items'>) => (
              <li key={item.id} className="nfce-item">
                <span>{item.description}</span>{' '}
                <MoneyText value={item.total_cents} kind="neutral" />
              </li>
            ))}
          </ul>
        </details>
      )}
      <Button fullWidth iconStart={ReceiptText} onClick={onUse} data-testid="nfce-use">
        {t('nfce.use')}
      </Button>
    </GlassCard>
  );
}

function OutcomeView({ outcome, onUse }: { outcome: NfceOutcome; onUse: () => void }) {
  const navigate = useNavigate();
  switch (outcome.kind) {
    case 'invalid':
      return <Banner tone="warning" icon={TriangleAlert} message={t('nfce.invalid')} />;
    case 'repeated': {
      const txId = outcome.txId;
      return (
        <Banner
          icon={Info}
          message={t('nfce.repeated', { data: dayMonth(outcome.receipt.created_at) })}
          {...(txId
            ? {
                action: {
                  label: t('nfce.viewTx'),
                  onPress: () => void navigate(`/lancamentos/${txId}`),
                },
              }
            : {})}
        />
      );
    }
    case 'attached':
      return (
        <Banner
          icon={Check}
          message={t('nfce.attached', { valor: formatBRL(outcome.tx.amount_cents) })}
          action={{
            label: t('nfce.viewTx'),
            onPress: () => void navigate(`/lancamentos/${outcome.tx.id}`),
          }}
        />
      );
    case 'prefill': {
      const banner =
        outcome.read === 'pending' ? (
          <Banner icon={CloudOff} message={t('nfce.offline')} />
        ) : outcome.read === 'fallback' ? (
          <Banner tone="warning" icon={TriangleAlert} message={t('nfce.sefazDown')} />
        ) : (
          <p className="sr-only">
            {t('nfce.found', {
              loja: outcome.draft.description,
              valor: formatBRL(outcome.draft.amountCents ?? 0),
            })}
          </p>
        );
      return (
        <>
          {banner}
          <ReceiptSummary outcome={outcome} onUse={onUse} />
        </>
      );
    }
  }
}

export function NfceScreen() {
  const { user, client } = useAuth();
  const today = useToday();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<NfceOutcome | null>(null);
  const [sheet, setSheet] = useState<QuickEntryNfce | null>(null);
  const online = useOnline();
  if (!user) {
    return <section className="screen" data-screen="I04" data-testid="screen-I04" />;
  }
  const read = async (input: string | null) => {
    if (input === null) {
      setOutcome({ kind: 'invalid' });
      return;
    }
    setBusy(true);
    setOutcome(null);
    try {
      setOutcome(
        await processNfce(input, {
          db: user.db,
          userId: user.userId,
          today,
          read: (raw) =>
            client
              ? readNfce(client, raw)
              : Promise.resolve({ status: 'fallback', errorCode: 'NFCE_UNAVAILABLE' }),
        }),
      );
    } finally {
      setBusy(false);
    }
  };
  const closeSheet = async () => {
    const receiptId = sheet?.receiptId;
    setSheet(null);
    if (!receiptId) {
      return;
    }
    // salvo pelo Q01: vai para o lançamento (T02 mostra "Aguardando nota" e o "Tentar ler a nota de novo")
    const tx = await user.db.transactions
      .filter((row) => row.nfce_receipt_id === receiptId && row.deleted_at === null)
      .first();
    if (tx) {
      void navigate(`/lancamentos/${tx.id}`);
    }
  };
  return (
    <section className="screen nfce" data-screen="I04" data-testid="screen-I04">
      {/* D-096: sem internet, avisa antes da câmera que a nota fica guardada e os itens entram depois */}
      {!online && !outcome && (
        <Banner
          icon={CloudOff}
          message={t('nfce.offlineBefore')}
          data-testid="nfce-offline-before"
        />
      )}
      <QrScanner
        onResult={(raw) => void read(raw)}
        onManualKey={(key) => void read(key)}
        busy={busy}
      />
      <div aria-live="polite" data-testid="nfce-outcome">
        {outcome ? (
          <OutcomeView
            outcome={outcome}
            onUse={() => outcome.kind === 'prefill' && setSheet(prefillOf(outcome))}
          />
        ) : null}
      </div>
      {sheet && (
        <Suspense fallback={null}>
          <QuickEntrySheet nfce={sheet} onClose={() => void closeSheet()} today={today} />
        </Suspense>
      )}
    </section>
  );
}
