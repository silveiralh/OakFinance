// I01 — Conexões e importação e I02 — Conectar banco (UX §3 I01/I02; US-45, US-46; RN-79, RN-80).
// O fluxo segue a tech §6.1.3: token → Pluggy Connect sob demanda (ou "Tenho um Item ID") → `pluggy-link-item`
// → mapeamento das contas (RPC `map_external_account`) → `pluggy-sync` backfill de 90 dias → resultado.
import { type ISODate, todayIn } from '@oakfinance/domain';
import { FileUp, Landmark, QrCode } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { useLive } from '../../data/live';
import { emptyStates, t } from '../../i18n/pt-BR';
import { useOnline } from '../../lib/online';
import { Button, EmptyState, GlassCard, ProgressBar, Select, TextField } from '../../ui';
import {
  applyMapping,
  backfill,
  linkItem,
  type MapClient,
  requestConnectToken,
  withE2e,
} from './api';
import { BankConnectionCard } from './BankConnectionCard';
import {
  bankName,
  type ConnectTokenResponse,
  cardMissing,
  defaultChoice,
  type ExternalAccountDTO,
  errorText,
  isCredit,
  type LinkResponse,
  linkTargets,
  type MapChoice,
  normalizeItemId,
  type SyncSummary,
} from './model';
import { PluggyWidget, widgetAvailable } from './PluggyWidget';
import { summarizeSince } from './summary';

function today(): ISODate {
  return todayIn('America/Sao_Paulo', new Date()) as ISODate;
}

/** I01: bancos conectados, importar extrato e nota fiscal. Sem rede, só a importação funciona. */
export function ConnectionsScreen() {
  const { user } = useAuth();
  const online = useOnline();
  const navigate = useNavigate();
  const connections = useLive(user ? () => user.db.bank_connections.toArray() : null, [
    user?.userId,
  ]);
  if (!user || connections === undefined) {
    return <section className="screen" data-screen="I01" data-testid="screen-I01" />;
  }
  const active = connections.filter((c) => c.deleted_at === null && c.is_active);
  const empty = emptyStates.connections;
  return (
    <section className="screen connections" data-screen="I01" data-testid="screen-I01">
      <GlassCard level={2} title={t('conn.section.banks')} data-testid="connections-banks">
        {active.length === 0 ? (
          <EmptyState
            icon={Landmark}
            title={empty.title}
            description={empty.text}
            secondaryAction={{ label: empty.actions[1], onPress: () => void navigate('/importar') }}
            data-testid="connections-empty"
          />
        ) : (
          <ul className="bank-connections">
            {active.map((c) => (
              <BankConnectionCard key={c.id} connection={c} />
            ))}
          </ul>
        )}
        <Button
          iconStart={Landmark}
          fullWidth
          disabled={!online}
          disabledReason={t('conn.needsInternet')}
          onClick={() => void navigate('/ajustes/conexoes/novo')}
        >
          {t('conn.connect')}
        </Button>
      </GlassCard>
      <GlassCard level={2} title={t('conn.section.import')}>
        <Button
          variant="secondary"
          iconStart={FileUp}
          fullWidth
          onClick={() => void navigate('/importar')}
        >
          {t('import.choose')}
        </Button>
        <p className="account-meta">{t('import.bbHint')}</p>
      </GlassCard>
      <GlassCard level={2} title={t('conn.section.nfce')}>
        <Button
          variant="secondary"
          iconStart={QrCode}
          fullWidth
          disabled={!online}
          disabledReason={t('conn.needsInternet')}
          onClick={() => void navigate('/nota')}
        >
          {t('conn.nfce.read')}
        </Button>
        <p className="account-meta">{t('conn.nfce.hint')}</p>
      </GlassCard>
    </section>
  );
}

type Step =
  | { kind: 'explain' }
  | { kind: 'widget'; token: ConnectTokenResponse }
  | { kind: 'linking' }
  | { kind: 'mapping'; link: LinkResponse; choices: Record<string, MapChoice> }
  | { kind: 'syncing' }
  | { kind: 'result'; inserted: number; summary: SyncSummary | null; failed: string | null };

/** Título de cada conta do banco no mapeamento: nome (ou tipo) e o final do número. */
function accountTitle(account: ExternalAccountDTO): string {
  const kind = isCredit(account)
    ? t('conn.kind.credit')
    : account.subtype === 'SAVINGS_ACCOUNT'
      ? t('conn.kind.savings')
      : t('conn.kind.checking');
  const name = account.name?.trim() || kind;
  return account.numberMasked ? `${name} · ${account.numberMasked}` : name;
}

/** I02: explicação → Pluggy Connect (ou Item ID) → mapeamento → "Buscando os últimos 90 dias…" → resultado. */
export function ConnectBankScreen() {
  const auth = useAuth();
  const { user } = auth;
  const client = auth.client ? withE2e(auth.client as typeof auth.client & MapClient) : null;
  const online = useOnline();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ kind: 'explain' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showItemId, setShowItemId] = useState(!widgetAvailable);
  const [itemId, setItemId] = useState('');
  const [mapError, setMapError] = useState<{ accountId: string | null; message: string } | null>(
    null,
  );
  const local = useLive(
    user
      ? async () => ({
          accounts: await user.db.accounts.toArray(),
          cards: await user.db.cards.toArray(),
          connections: await user.db.bank_connections.toArray(),
        })
      : null,
    [user?.userId],
  );

  if (!user || !local) {
    return <section className="screen" data-screen="I02" data-testid="screen-I02" />;
  }
  const connectionOf = (id: string) => local.connections.find((c) => c.id === id) ?? null;
  const banco = (id: string | null) => bankName(id ? connectionOf(id) : null);

  const start = async () => {
    if (!client) {
      return;
    }
    setBusy(true);
    setError(null);
    const result = await requestConnectToken(client);
    setBusy(false);
    if (!result.ok) {
      setError(errorText(result, banco(null)));
      return;
    }
    setStep({ kind: 'widget', token: result.data });
  };

  const link = async (id: string) => {
    if (!client) {
      return;
    }
    setStep({ kind: 'linking' });
    setError(null);
    const result = await linkItem(client, id);
    if (!result.ok) {
      setError(errorText(result, banco(null)));
      setStep({ kind: 'explain' });
      return;
    }
    // a conexão e as contas chegam pelo pull; o mapeamento usa a resposta da função
    void user.engine.syncNow();
    const name = banco(result.data.connectionId);
    const choices: Record<string, MapChoice> = {};
    for (const account of result.data.accounts) {
      choices[account.id] = defaultChoice(
        account,
        linkTargets(account, local.accounts, local.cards),
        name,
      );
    }
    setStep({ kind: 'mapping', link: result.data, choices });
  };

  const validateItemId = () => {
    const id = normalizeItemId(itemId);
    if (!id) {
      setError(t('conn.itemNotFound'));
      return;
    }
    void link(id);
  };

  const saveMapping = async (current: Extract<Step, { kind: 'mapping' }>) => {
    if (!client) {
      return;
    }
    setBusy(true);
    setMapError(null);
    const connection = connectionOf(current.link.connectionId);
    const mapped = await applyMapping(current.link.accounts, current.choices, {
      db: user.db,
      userId: user.userId,
      client,
      today: today(),
      institution: connection?.institution ?? null,
      // um ciclo que já estava rodando pode ter começado antes das linhas novas: espera ele e roda outro
      flush: async () => {
        await user.engine.syncNow();
        return (await user.engine.syncNow()).ok;
      },
      notifyWrite: () => user.engine.notifyWrite(),
    });
    setBusy(false);
    if (!mapped.ok) {
      setMapError({ accountId: mapped.accountId, message: mapped.message });
      return;
    }
    setStep({ kind: 'syncing' });
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const synced = await backfill(client, current.link.connectionId);
    if (!synced.ok) {
      setStep({
        kind: 'result',
        inserted: 0,
        summary: null,
        failed: errorText(synced, banco(current.link.connectionId)),
      });
      return;
    }
    await user.engine.syncNow();
    const summary = await summarizeSince(user.db, current.link.connectionId, startedAt);
    setStep({ kind: 'result', inserted: synced.data.stats.inserted, summary, failed: null });
  };

  return (
    <section className="screen connect-bank" data-screen="I02" data-testid="screen-I02">
      {error && (
        <p className="form-error" role="alert" data-testid="connect-error">
          {error}
        </p>
      )}
      {step.kind === 'explain' && (
        <GlassCard level={2} data-testid="connect-explain">
          <p>{t('conn.explain')}</p>
          {widgetAvailable && (
            <Button
              fullWidth
              loading={busy}
              disabled={!online}
              disabledReason={t('conn.needsInternet')}
              onClick={() => void start()}
            >
              {t('conn.continue')}
            </Button>
          )}
          {!showItemId ? (
            <Button variant="ghost" fullWidth onClick={() => setShowItemId(true)}>
              {t('conn.itemId')}
            </Button>
          ) : (
            <form
              className="connect-item-id"
              onSubmit={(event) => {
                event.preventDefault();
                validateItemId();
              }}
            >
              <TextField
                label={t('conn.itemId.label')}
                hint={t('conn.itemId.hint')}
                value={itemId}
                onChange={setItemId}
                autoComplete="off"
              />
              <Button
                type="submit"
                variant="secondary"
                fullWidth
                disabled={!online}
                disabledReason={t('conn.needsInternet')}
              >
                {t('conn.itemId.validate')}
              </Button>
            </form>
          )}
        </GlassCard>
      )}
      {step.kind === 'widget' && (
        <PluggyWidget
          connectToken={step.token.connectToken}
          connectorIds={step.token.connectorIds}
          onSuccess={(id) => void link(id)}
          onError={() => {
            setError(t('conn.failed'));
            setStep({ kind: 'explain' });
          }}
          onClose={() => {
            setError(t('conn.cancelled'));
            setStep({ kind: 'explain' });
          }}
        />
      )}
      {step.kind === 'linking' && (
        <ProgressBar valueCents={0} maxCents={1} indeterminate label={t('conn.validating')} />
      )}
      {step.kind === 'mapping' && (
        <MappingStep
          step={step}
          banco={banco(step.link.connectionId)}
          institution={connectionOf(step.link.connectionId)?.institution ?? null}
          accounts={local.accounts}
          cards={local.cards}
          busy={busy}
          online={online}
          error={mapError}
          onChange={(choices) => setStep({ ...step, choices })}
          onSave={() => void saveMapping(step)}
        />
      )}
      {step.kind === 'syncing' && (
        <GlassCard level={2} data-testid="connect-syncing">
          <p role="status">{t('conn.connected')}</p>
          <ProgressBar valueCents={0} maxCents={1} indeterminate label={t('conn.connected')} />
        </GlassCard>
      )}
      {step.kind === 'result' && (
        <GlassCard level={2} data-testid="connect-result">
          <p role="status">
            {step.failed ?? t('conn.result', { n: step.inserted, m: step.summary?.review ?? 0 })}
          </p>
          <Button fullWidth onClick={() => void navigate('/conferir')}>
            {t('conn.review')}
          </Button>
          <Button variant="ghost" fullWidth onClick={() => void navigate('/ajustes/conexoes')}>
            {t('conn.later')}
          </Button>
        </GlassCard>
      )}
    </section>
  );
}

interface MappingProps {
  step: Extract<Step, { kind: 'mapping' }>;
  banco: string;
  institution: string | null;
  accounts: Parameters<typeof linkTargets>[1];
  cards: Parameters<typeof linkTargets>[2];
  busy: boolean;
  online: boolean;
  error: { accountId: string | null; message: string } | null;
  onChange: (choices: Record<string, MapChoice>) => void;
  onSave: () => void;
}

const CREATE = 'create';
const IGNORE = 'ignore';

/** Para cada conta do banco: vincular a uma conta ou cartão existente, criar nova (pré-preenchida) ou ignorar. */
function MappingStep(props: MappingProps) {
  const { step, banco } = props;
  const set = (id: string, choice: MapChoice) => props.onChange({ ...step.choices, [id]: choice });
  return (
    <GlassCard level={2} title={t('conn.map.title')} data-testid="connect-mapping">
      {cardMissing(step.link.accounts, props.institution) && (
        <p className="account-meta" role="note">
          {t('conn.cardMissing', { banco })}
        </p>
      )}
      <ul className="connect-mapping">
        {step.link.accounts.map((account) => {
          const choice = step.choices[account.id] ?? { kind: 'ignore' };
          const targets = linkTargets(account, props.accounts, props.cards);
          const value =
            choice.kind === 'link' ? choice.target : choice.kind === 'create' ? CREATE : IGNORE;
          const fallback = defaultChoice(account, [], banco);
          const fieldError =
            props.error && props.error.accountId === account.id ? props.error.message : undefined;
          return (
            <li key={account.id} data-testid={`map-${account.id}`}>
              <Select
                label={accountTitle(account)}
                hint={t('conn.map.link')}
                value={value}
                options={[
                  ...targets,
                  { value: CREATE, label: t('conn.map.create') },
                  { value: IGNORE, label: t('conn.map.ignore') },
                ]}
                onChange={(next) => {
                  if (next === IGNORE) {
                    set(account.id, { kind: 'ignore' });
                  } else if (next === CREATE) {
                    set(account.id, fallback.kind === 'create' ? fallback : { kind: 'ignore' });
                  } else {
                    set(account.id, { kind: 'link', target: next });
                  }
                }}
              />
              {choice.kind === 'create' && (
                <div className="connect-create">
                  <TextField
                    label={t(isCredit(account) ? 'cards.name' : 'accounts.name')}
                    value={choice.name}
                    onChange={(name) => set(account.id, { ...choice, name })}
                    {...(fieldError ? { error: fieldError } : {})}
                  />
                  {isCredit(account) && (
                    <>
                      <TextField
                        label={t('cards.closing')}
                        inputMode="numeric"
                        value={choice.closingDay}
                        onChange={(closingDay) => set(account.id, { ...choice, closingDay })}
                      />
                      <TextField
                        label={t('cards.due')}
                        inputMode="numeric"
                        value={choice.dueDay}
                        onChange={(dueDay) => set(account.id, { ...choice, dueDay })}
                      />
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {props.error && props.error.accountId === null && (
        <p className="form-error" role="alert">
          {props.error.message}
        </p>
      )}
      <Button
        fullWidth
        loading={props.busy}
        disabled={!props.online}
        disabledReason={t('conn.needsInternet')}
        onClick={props.onSave}
      >
        {t('conn.map.save')}
      </Button>
    </GlassCard>
  );
}
